const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const readline = require("readline");
const { startEweAudioTranslation } = require("./ewe-audio-route");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "outputs");

for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(express.json({ limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/outputs", express.static(OUTPUT_DIR));

const upload = multer({
    dest: UPLOAD_DIR
});

const jobs = new Map();

function pythonCommand() {
    if (process.platform === "win32") {
        return path.join(__dirname, ".venv", "Scripts", "python.exe");
    }
    return path.join(__dirname, ".venv", "bin", "python");
}

function ffmpegExtractAudio(input, output, callback) {
    execFile("ffmpeg", [
        "-y",
        "-i", input,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        output
    ], callback);
}

function ffmpegExtractPlayableAudio(input, output, callback) {
    execFile("ffmpeg", [
        "-y",
        "-i", input,
        "-vn",
        "-ac", "2",
        "-ar", "44100",
        "-b:a", "192k",
        output
    ], callback);
}

function parseTime(value) {
    const parts = value.replace(",", ".").split(":");
    return Number(parts[0]) * 3600 +
           Number(parts[1]) * 60 +
           Number(parts[2]);
}

function parseSRT(srt) {
    const blocks = srt.trim().split(/\r?\n\r?\n/);
    const result = [];

    for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        if (lines.length < 3) continue;

        const times = lines[1].split(/\s+-->\s+/);
        if (times.length !== 2) continue;

        result.push({
            id: Number(lines[0]) || result.length + 1,
            start: parseTime(times[0]),
            end: parseTime(times[1]),
            text: lines.slice(2).join(" ").trim()
        });
    }

    return result;
}

app.get("/api/status", (req, res) => {
    res.json({ success: true });
});

/*
 * EXTRACTION AUDIO + TRANSCRIPTION EN PARALLÈLE
 */
app.post("/api/transcribe", upload.single("video"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            error: "Aucune vidéo reçue."
        });
    }

    const sourceLanguage = req.body.sourceLanguage || "eng_Latn";
    const jobId = crypto.randomUUID();

    const extension = path.extname(req.file.originalname) || ".mp4";
    const videoPath = path.join(UPLOAD_DIR, `${jobId}${extension}`);
    const wavPath = path.join(UPLOAD_DIR, `${jobId}.wav`);
    const audioPath = path.join(OUTPUT_DIR, `${jobId}-audio.mp3`);

    fs.renameSync(req.file.path, videoPath);

    jobs.set(jobId, {
        status: "processing",
        progress: 5,
        stage: "starting",
        sourceLanguage,
        subtitles: [],
        audioUrl: null,
        done: false,
        error: null
    });

    /*
     * On extrait l'audio jouable immédiatement.
     */
    ffmpegExtractPlayableAudio(videoPath, audioPath, (audioError) => {
        const job = jobs.get(jobId);

        if (!job) return;

        if (audioError) {
            job.status = "error";
            job.error = "Impossible d'extraire l'audio : " + audioError.message;
            job.done = true;
            return;
        }

        job.progress = 25;
        job.stage = "audio_complete";
        job.audioUrl = `/outputs/${path.basename(audioPath)}`;

        /*
         * WAV interne destiné à Whisper.
         */
        ffmpegExtractAudio(videoPath, wavPath, (wavError) => {
            const currentJob = jobs.get(jobId);

            if (!currentJob) return;

            if (wavError) {
                currentJob.status = "error";
                currentJob.error = "Préparation de l'audio pour la transcription impossible : " + wavError.message;
                currentJob.done = true;
                return;
            }

            currentJob.progress = 30;
            currentJob.stage = "transcription";

            const python = spawn(
                pythonCommand(),
                [
                    path.join(__dirname, "transcribe.py"),
                    wavPath,
                    sourceLanguage
                ],
                {
                    windowsHide: true
                }
            );

            const rl = readline.createInterface({
                input: python.stdout
            });

            rl.on("line", (line) => {
                try {
                    const event = JSON.parse(line);
                    const activeJob = jobs.get(jobId);

                    if (!activeJob) return;

                    if (event.type === "start") {
                        activeJob.progress = event.progress || 30;
                        activeJob.stage = "transcription";
                    }

                    if (event.type === "progress") {
                        activeJob.progress = event.progress || activeJob.progress;
                        activeJob.stage = "transcription";

                        if (Array.isArray(event.segments)) {
                            activeJob.subtitles.push(...event.segments);
                        }
                    }

                    if (event.type === "complete") {
                        activeJob.progress = 100;
                        activeJob.stage = "complete";
                        activeJob.status = "complete";
                        activeJob.done = true;

                        if (Array.isArray(event.segments)) {
                            activeJob.subtitles = event.segments;
                        }

                        try { fs.unlinkSync(wavPath); } catch {}
                        try { fs.unlinkSync(videoPath); } catch {}
                    }
                } catch {}
            });

            let stderr = "";

            python.stderr.on("data", data => {
                stderr += data.toString();
            });

            python.on("error", error => {
                const activeJob = jobs.get(jobId);
                if (!activeJob) return;

                activeJob.status = "error";
                activeJob.error = error.message;
                activeJob.done = true;
            });

            python.on("close", code => {
                const activeJob = jobs.get(jobId);
                if (!activeJob) return;

                if (code !== 0 && !activeJob.done) {
                    activeJob.status = "error";
                    activeJob.error = stderr || `Transcription arrêtée (code ${code}).`;
                    activeJob.done = true;
                }
            });
        });
    });

    /*
     * Réponse immédiate : le navigateur commence à suivre le job.
     */
    res.json({
        success: true,
        jobId,
        progress: 5,
        stage: "starting"
    });
});

app.get("/api/transcribe/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);

    if (!job) {
        return res.status(404).json({
            success: false,
            error: "Job introuvable."
        });
    }

    res.json({
        success: true,
        ...job
    });
});

app.post("/api/translate", (req, res) => {

    try {

        const sourceLanguage =
            req.body.sourceLanguage || "eng_Latn";

        const targetLanguage =
            req.body.targetLanguage || "ewe_Latn";

        const subtitles =
            Array.isArray(req.body.subtitles)
                ? req.body.subtitles
                : [];

        if (!subtitles.length) {
            return res.status(400).json({
                success: false,
                error: "Aucun texte à traduire."
            });
        }

        const jobId = crypto.randomUUID();

        const input = path.join(
            UPLOAD_DIR,
            `${jobId}-input.srt`
        );

        const output = path.join(
            UPLOAD_DIR,
            `${jobId}-output.srt`
        );

        function fmt(sec) {

            sec = Number(sec) || 0;

            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = Math.floor(sec % 60);
            const ms = Math.floor(
                (sec - Math.floor(sec)) * 1000
            );

            return (
                String(h).padStart(2, "0") +
                ":" +
                String(m).padStart(2, "0") +
                ":" +
                String(s).padStart(2, "0") +
                "," +
                String(ms).padStart(3, "0")
            );
        }

        const inputSrt = subtitles.map((s, i) => {

            return (
                `${i + 1}\n` +
                `${fmt(s.start)} --> ${fmt(s.end)}\n` +
                `${s.text || ""}`
            );

        }).join("\n\n");

        fs.writeFileSync(
            input,
            inputSrt,
            "utf8"
        );

        jobs.set(jobId, {

            type: "translation",

            status: "processing",

            progress: 0,

            stage: "starting",

            sourceLanguage,

            targetLanguage,

            subtitles: [],

            done: false,

            error: null
        });

        const python = spawn(
            pythonCommand(),
            [
                path.join(
                    __dirname,
                    "translate_srt.py"
                ),
                input,
                output,
                sourceLanguage,
                targetLanguage
            ],
            {
                windowsHide: true
            }
        );

        const rl = readline.createInterface({
            input: python.stdout
        });

        let stderr = "";

        python.stderr.on(
            "data",
            data => {
                stderr += data.toString();
            }
        );

        rl.on("line", line => {

            try {

                const event =
                    JSON.parse(line);

                const job =
                    jobs.get(jobId);

                if (!job) return;

                if (event.type === "start") {

                    job.progress =
                        event.progress || 5;

                    job.stage =
                        event.stage ||
                        "translation";
                }

                if (event.type === "progress") {

                    job.progress =
                        event.progress ||
                        job.progress;

                    job.stage =
                        "translation";

                    if (event.subtitle) {

                        job.subtitles.push(
                            event.subtitle
                        );
                    }
                }

                if (event.type === "complete") {

                    job.progress = 100;

                    job.stage = "complete";

                    job.status = "complete";

                    job.done = true;

                    if (
                        Array.isArray(
                            event.segments
                        )
                    ) {

                        job.subtitles =
                            event.segments;
                    }

                    try {
                        fs.unlinkSync(input);
                    } catch {}

                    try {
                        fs.unlinkSync(output);
                    } catch {}
                }

                if (event.type === "error") {

                    job.status = "error";

                    job.error =
                        event.error ||
                        "Erreur de traduction.";

                    job.done = true;
                }

            } catch (error) {

                console.log(
                    "Ligne Python ignorée :",
                    line
                );
            }
        });

        python.on(
            "error",
            error => {

                const job =
                    jobs.get(jobId);

                if (!job) return;

                job.status = "error";

                job.error =
                    error.message;

                job.done = true;
            }
        );

        python.on(
            "close",
            code => {

                const job =
                    jobs.get(jobId);

                if (!job) return;

                if (
                    code !== 0 &&
                    !job.done
                ) {

                    job.status = "error";

                    job.error =
                        stderr ||
                        `Traduction arrêtée (code ${code}).`;

                    job.done = true;
                }
            }
        );

        res.json({

            success: true,

            jobId,

            progress: 0,

            stage: "starting"
        });

    } catch (error) {

        res.status(500).json({

            success: false,

            error: error.message
        });
    }
});


app.get("/api/translate/:jobId", (req, res) => {

    const job =
        jobs.get(req.params.jobId);

    if (!job) {

        return res.status(404).json({

            success: false,

            error: "Job de traduction introuvable."
        });
    }

    res.json({

        success: true,

        ...job
    });
});


app.post("/api/translate-audio", async (req, res) => {
    try {
        let sourceJob = null;

        if (req.body && req.body.transcriptionJobId) {
            sourceJob = jobs.get(req.body.transcriptionJobId);
        }

        if (!sourceJob) {
            for (const job of jobs.values()) {
                if (
                    job.status === "complete" &&
                    Array.isArray(job.subtitles) &&
                    job.subtitles.length > 0
                ) {
                    sourceJob = job;
                }
            }
        }

        if (!sourceJob) {
            return res.status(400).json({
                success: false,
                error: "Aucune transcription terminée disponible."
            });
        }

        const jobId = crypto.randomUUID();

        jobs.set(jobId, {
            status: "processing",
            progress: 5,
            stage: "starting",
            sourceLanguage: sourceJob.sourceLanguage || "eng_Latn",
            subtitles: [],
            audioUrl: null,
            done: false,
            error: null
        });

        const audioJob = jobs.get(jobId);

        startEweAudioTranslation({
            subtitles: sourceJob.subtitles,
            sourceLanguage: sourceJob.sourceLanguage || "eng_Latn",
            outputDir: OUTPUT_DIR,
            job: audioJob
        }).catch(error => {
            audioJob.status = "error";
            audioJob.error = error.message;
            audioJob.done = true;
        });

        res.json({
            success: true,
            jobId,
            progress: 5,
            stage: "starting"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get("/api/translate-audio/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);

    if (!job) {
        return res.status(404).json({
            success: false,
            error: "Job de traduction audio introuvable."
        });
    }

    res.json({
        success: true,
        ...job
    });
});

app.listen(PORT, () => {
    console.log(`EweVoice lancé sur le port ${PORT}`);
});

