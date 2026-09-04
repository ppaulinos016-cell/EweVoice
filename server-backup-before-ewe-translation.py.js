const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const readline = require("readline");

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

app.post("/api/translate", async (req, res) => {
    try {
        const sourceLanguage = req.body.sourceLanguage || "eng_Latn";
        const targetLanguage = req.body.targetLanguage || "ewe_Latn";
        const subtitles = Array.isArray(req.body.subtitles) ? req.body.subtitles : [];

        if (!subtitles.length) {
            return res.status(400).json({
                success: false,
                error: "Aucun texte à traduire."
            });
        }

        const inputSrt = subtitles.map((s, i) => {
            const fmt = sec => {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const ss = Math.floor(sec % 60);
                const ms = Math.floor((sec % 1) * 1000);
                return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
            };

            return `${i + 1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${s.text}`;
        }).join("\n\n");

        const id = crypto.randomUUID();
        const input = path.join(UPLOAD_DIR, `${id}-input.srt`);
        const output = path.join(UPLOAD_DIR, `${id}-output.srt`);

        fs.writeFileSync(input, inputSrt, "utf8");

        const python = spawn(
            pythonCommand(),
            [
                path.join(__dirname, "translate_srt.py"),
                input,
                output,
                sourceLanguage,
                targetLanguage
            ],
            { windowsHide: true }
        );

        let stderr = "";

        python.stderr.on("data", d => stderr += d.toString());

        python.on("close", code => {
            if (code !== 0) {
                return res.status(500).json({
                    success: false,
                    error: stderr || "Erreur de traduction."
                });
            }

            const translated = parseSRT(fs.readFileSync(output, "utf8"));

            try { fs.unlinkSync(input); } catch {}
            try { fs.unlinkSync(output); } catch {}

            res.json({
                success: true,
                subtitles: translated
            });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`EweVoice lancé sur le port ${PORT}`);
});
