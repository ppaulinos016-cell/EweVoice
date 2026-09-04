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
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));
app.use("/outputs", express.static(OUTPUT_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

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
    execFile(
        "ffmpeg",
        [
            "-y",
            "-i", input,
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            "-c:a", "pcm_s16le",
            output
        ],
        callback
    );
}

function ffmpegExtractPlayableAudio(input, output, callback) {
    execFile(
        "ffmpeg",
        [
            "-y",
            "-i", input,
            "-vn",
            "-ac", "2",
            "-ar", "44100",
            "-b:a", "192k",
            output
        ],
        callback
    );
}

function parseTime(value) {
    const parts = value.replace(",", ".").split(":");

    return (
        Number(parts[0]) * 3600 +
        Number(parts[1]) * 60 +
        Number(parts[2])
    );
}

function parseSRT(srt) {
    const blocks = srt.trim().split(/\r?\n\r?\n/);
    const result = [];

    for (const block of blocks) {
        const lines = block.split(/\r?\n/);

        if (lines.length < 3) {
            continue;
        }

        const times = lines[1].split(/\s+-->\s+/);

        if (times.length !== 2) {
            continue;
        }

        result.push({
            id: Number(lines[0]) || result.length + 1,
            start: parseTime(times[0]),
            end: parseTime(times[1]),
            text: lines.slice(2).join(" ").trim()
        });
    }

    return result;
}

/*
 * ============================================================
 * STATUS
 * ============================================================
 */

app.get("/api/status", (req, res) => {
    res.json({
        success: true
    });
});

/*
 * ============================================================
 * TRANSCRIPTION
 * VIDEO -> AUDIO -> WHISPER
 * ============================================================
 */

app.post("/api/transcribe", upload.single("video"), (req, res) => {

    if (!req.file) {
        return res.status(400).json({
            success: false,
            error: "Aucune vidéo reçue."
        });
    }

    const sourceLanguage =
        req.body.sourceLanguage || "eng_Latn";

    const jobId = crypto.randomUUID();

    const extension =
        path.extname(req.file.originalname) || ".mp4";

    const videoPath =
        path.join(
            UPLOAD_DIR,
            `${jobId}${extension}`
        );

    const wavPath =
        path.join(
            UPLOAD_DIR,
            `${jobId}.wav`
        );

    const audioPath =
        path.join(
            OUTPUT_DIR,
            `${jobId}-audio.mp3`
        );

    fs.renameSync(
        req.file.path,
        videoPath
    );

    jobs.set(jobId, {
        status: "processing",
        progress: 5,
        stage: "starting",
        sourceLanguage,
        subtitles: [],
        audioUrl: null,
        done: false,
        error: null,
        sourceVideoPath: videoPath,
        sourceVideoUrl:
            `/uploads/${path.basename(videoPath)}`
    });

    const job = jobs.get(jobId);

    /*
     * Extraction de l'audio jouable.
     */
    ffmpegExtractPlayableAudio(
        videoPath,
        audioPath,
        (audioError) => {

            if (!job) {
                return;
            }

            if (audioError) {

                job.status = "error";
                job.error =
                    "Impossible d'extraire l'audio : " +
                    audioError.message;
                job.done = true;

                return;
            }

            job.progress = 25;
            job.stage = "audio_complete";

            job.audioUrl =
                `/outputs/${path.basename(audioPath)}`;

            /*
             * WAV interne pour Whisper.
             */
            ffmpegExtractAudio(
                videoPath,
                wavPath,
                (wavError) => {

                    if (!job) {
                        return;
                    }

                    if (wavError) {

                        job.status = "error";
                        job.error =
                            "Préparation de l'audio pour la transcription impossible : " +
                            wavError.message;
                        job.done = true;

                        return;
                    }

                    job.progress = 30;
                    job.stage = "transcription";

                    const python =
                        spawn(
                            pythonCommand(),
                            [
                                path.join(
                                    __dirname,
                                    "transcribe.py"
                                ),
                                wavPath,
                                sourceLanguage
                            ],
                            {
                                windowsHide: true
                            }
                        );

                    const rl =
                        readline.createInterface({
                            input: python.stdout
                        });

                    rl.on("line", (line) => {

                        try {

                            const event =
                                JSON.parse(line);

                            const activeJob =
                                jobs.get(jobId);

                            if (!activeJob) {
                                return;
                            }

                            if (
                                event.type === "start"
                            ) {

                                activeJob.progress =
                                    event.progress || 30;

                                activeJob.stage =
                                    event.stage ||
                                    "transcription";
                            }

                            if (
                                event.type === "progress"
                            ) {

                                activeJob.progress =
                                    event.progress ||
                                    activeJob.progress;

                                activeJob.stage =
                                    "transcription";

                                if (
                                    Array.isArray(
                                        event.segments
                                    )
                                ) {

                                    activeJob.subtitles.push(
                                        ...event.segments
                                    );
                                }
                            }

                            if (
                                event.type === "complete"
                            ) {

                                activeJob.progress = 100;
                                activeJob.stage = "complete";
                                activeJob.status = "complete";
                                activeJob.done = true;

                                if (
                                    Array.isArray(
                                        event.segments
                                    )
                                ) {

                                    activeJob.subtitles =
                                        event.segments;
                                }

                                try {
                                    fs.unlinkSync(wavPath);
                                } catch {}

                                activeJob.sourceVideoPath =
                                    videoPath;

                                activeJob.sourceVideoUrl =
                                    `/uploads/${path.basename(videoPath)}`;
                            }

                        } catch {}
                    });

                    let stderr = "";

                    python.stderr.on(
                        "data",
                        data => {
                            stderr +=
                                data.toString();
                        }
                    );

                    python.on(
                        "error",
                        error => {

                            const activeJob =
                                jobs.get(jobId);

                            if (!activeJob) {
                                return;
                            }

                            activeJob.status = "error";
                            activeJob.error =
                                error.message;
                            activeJob.done = true;
                        }
                    );

                    python.on(
                        "close",
                        code => {

                            const activeJob =
                                jobs.get(jobId);

                            if (!activeJob) {
                                return;
                            }

                            if (
                                code !== 0 &&
                                !activeJob.done
                            ) {

                                activeJob.status =
                                    "error";

                                activeJob.error =
                                    stderr ||
                                    `Transcription arrêtée (code ${code}).`;

                                activeJob.done = true;
                            }
                        }
                    );
                }
            );
        }
    );

    res.json({
        success: true,
        jobId,
        progress: 5,
        stage: "starting"
    });
});

app.get(
    "/api/transcribe/:jobId",
    (req, res) => {

        const job =
            jobs.get(req.params.jobId);

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
    }
);

/*
 * ============================================================
 * TRADUCTION TEXTE
 * ============================================================
 */

app.post(
    "/api/translate",
    (req, res) => {

        try {

            const sourceLanguage =
                req.body.sourceLanguage ||
                "eng_Latn";

            const targetLanguage =
                req.body.targetLanguage ||
                "ewe_Latn";

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

            const jobId =
                crypto.randomUUID();

            const input =
                path.join(
                    UPLOAD_DIR,
                    `${jobId}-input.srt`
                );

            const output =
                path.join(
                    UPLOAD_DIR,
                    `${jobId}-output.srt`
                );

            function fmt(sec) {

                sec = Number(sec) || 0;

                const h =
                    Math.floor(sec / 3600);

                const m =
                    Math.floor(
                        (sec % 3600) / 60
                    );

                const s =
                    Math.floor(sec % 60);

                const ms =
                    Math.floor(
                        (sec -
                            Math.floor(sec)) *
                        1000
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

            const inputSrt =
                subtitles
                    .map((s, i) => {

                        return (
                            `${i + 1}\n` +
                            `${fmt(s.start)} --> ${fmt(s.end)}\n` +
                            `${s.text || ""}`
                        );
                    })
                    .join("\n\n");

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

            const python =
                spawn(
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

            const rl =
                readline.createInterface({
                    input: python.stdout
                });

            let stderr = "";

            python.stderr.on(
                "data",
                data => {
                    stderr +=
                        data.toString();
                }
            );

            rl.on(
                "line",
                line => {

                    try {

                        const event =
                            JSON.parse(line);

                        const job =
                            jobs.get(jobId);

                        if (!job) {
                            return;
                        }

                        if (
                            event.type === "start"
                        ) {

                            job.progress =
                                event.progress || 5;

                            job.stage =
                                event.stage ||
                                "translation";
                        }

                        if (
                            event.type === "progress"
                        ) {

                            job.progress =
                                event.progress ||
                                job.progress;

                            job.stage =
                                "translation";

                            if (
                                event.subtitle
                            ) {

                                job.subtitles.push(
                                    event.subtitle
                                );
                            }
                        }

                        if (
                            event.type === "complete"
                        ) {

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

                        if (
                            event.type === "error"
                        ) {

                            job.status = "error";

                            job.error =
                                event.error ||
                                "Erreur de traduction.";

                            job.done = true;
                        }

                    } catch {}
                }
            );

            python.on(
                "error",
                error => {

                    const job =
                        jobs.get(jobId);

                    if (!job) {
                        return;
                    }

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

                    if (!job) {
                        return;
                    }

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
    }
);

app.get(
    "/api/translate/:jobId",
    (req, res) => {

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
    }
);

/*
 * ============================================================
 * TRADUCTION AUDIO ÉWÉ
 *
 * Accepte :
 * - transcriptionJobId
 * - voicePreset
 * - voice (échantillon utilisateur)
 * ============================================================
 */

app.post(
    "/api/translate-audio",
    upload.single("voice"),
    async (req, res) => {

        try {

            let sourceJob = null;

            const transcriptionJobId =
                req.body?.transcriptionJobId;

            if (transcriptionJobId) {

                sourceJob =
                    jobs.get(
                        transcriptionJobId
                    );
            }

            /*
             * Si aucun ID n'est envoyé,
             * on récupère la dernière transcription complète.
             */
            if (!sourceJob) {

                for (
                    const job of jobs.values()
                ) {

                    if (
                        job.status === "complete" &&
                        Array.isArray(
                            job.subtitles
                        ) &&
                        job.subtitles.length > 0
                    ) {

                        sourceJob = job;
                    }
                }
            }

            if (!sourceJob) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Aucune transcription terminée disponible."
                });
            }

            const voicePreset =
                req.body?.voicePreset ||
                "current";

            let voiceReferencePath =
                req.body?.voiceReferencePath ||
                "";

            /*
             * Si "Ma propre voix" est sélectionnée
             * et qu'un fichier est envoyé avec le champ "voice",
             * on le sauvegarde réellement.
             */
            if (
                req.file &&
                voicePreset === "my-voice"
            ) {

                const extension =
                    path.extname(
                        req.file.originalname
                    ) || ".webm";

                const referencePath =
                    path.join(
                        OUTPUT_DIR,
                        `my-voice-reference-${crypto.randomUUID()}${extension}`
                    );

                fs.copyFileSync(
                    req.file.path,
                    referencePath
                );

                try {
                    fs.unlinkSync(
                        req.file.path
                    );
                } catch {}

                voiceReferencePath =
                    referencePath;
            }

            /*
             * Si le navigateur envoie une URL
             * déjà enregistrée, on la convertit en chemin.
             */
            if (
                voiceReferencePath &&
                voiceReferencePath.startsWith(
                    "/outputs/"
                )
            ) {

                voiceReferencePath =
                    path.join(
                        OUTPUT_DIR,
                        path.basename(
                            voiceReferencePath
                        )
                    );
            }

            /*
             * Pour les presets autres que my-voice,
             * aucune référence personnelle n'est obligatoire.
             */
            if (
                voicePreset !== "my-voice"
            ) {
                voiceReferencePath = "";
            }

            const jobId =
                crypto.randomUUID();

            jobs.set(jobId, {
                status: "processing",
                progress: 5,
                stage: "starting",
                sourceLanguage:
                    sourceJob.sourceLanguage ||
                    "eng_Latn",
                voicePreset,
                voiceReferencePath,
                subtitles: [],
                audioUrl: null,
                done: false,
                error: null
            });

            const audioJob =
                jobs.get(jobId);

            startEweAudioTranslation({
                subtitles:
                    sourceJob.subtitles,

                sourceLanguage:
                    sourceJob.sourceLanguage ||
                    "eng_Latn",

                outputDir:
                    OUTPUT_DIR,

                job:
                    audioJob,

                voicePreset,
                voiceReferencePath

            }).catch(error => {

                audioJob.status = "error";

                audioJob.error =
                    error.message;

                audioJob.done = true;
            });

            res.json({
                success: true,
                jobId,
                progress: 5,
                stage: "starting",
                voicePreset
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

app.get(
    "/api/translate-audio/:jobId",
    (req, res) => {

        const job =
            jobs.get(req.params.jobId);

        if (!job) {

            return res.status(404).json({
                success: false,
                error:
                    "Job de traduction audio introuvable."
            });
        }

        res.json({
            success: true,
            ...job
        });
    }
);

/*
 * ============================================================
 * ENREGISTREMENT D'UNE VOIX DE RÉFÉRENCE
 * ============================================================
 */

app.post(
    "/api/save-voice-reference",
    upload.single("voice"),
    (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Aucun échantillon vocal reçu."
                });
            }

            const extension =
                path.extname(
                    req.file.originalname
                ) || ".webm";

            const referencePath =
                path.join(
                    OUTPUT_DIR,
                    "my-voice-reference" +
                    extension
                );

            fs.copyFileSync(
                req.file.path,
                referencePath
            );

            try {
                fs.unlinkSync(
                    req.file.path
                );
            } catch {}

            res.json({
                success: true,
                message:
                    "Échantillon vocal enregistré.",
                voiceReferenceUrl:
                    "/outputs/" +
                    path.basename(
                        referencePath
                    )
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

/*
 * ============================================================
 * APPLICATION AUDIO ÉWÉ À LA VIDÉO
 *
 * Une seule route.
 *
 * Vidéo originale :
 *   0:v:0
 *
 * Audio Éwé :
 *   1:a:0
 *
 * La vidéo est conservée sans réencodage.
 * L'audio original est remplacé par l'audio Éwé.
 * ============================================================
 */

app.post(
    "/api/apply-ewe-audio",
    async (req, res) => {

        try {

            const transcriptionJobId =
                req.body?.transcriptionJobId;

            const audioJobId =
                req.body?.audioJobId;

            let sourceJob =
                transcriptionJobId
                    ? jobs.get(
                        transcriptionJobId
                    )
                    : null;

            let audioJob =
                audioJobId
                    ? jobs.get(
                        audioJobId
                    )
                    : null;

            /*
             * Recherche automatique de la vidéo.
             */
            if (!sourceJob) {

                for (
                    const job of jobs.values()
                ) {

                    if (
                        job.sourceVideoPath &&
                        fs.existsSync(
                            job.sourceVideoPath
                        )
                    ) {

                        sourceJob = job;
                        break;
                    }
                }
            }

            /*
             * Recherche automatique du dernier audio Éwé.
             */
            if (!audioJob) {

                for (
                    const job of jobs.values()
                ) {

                    if (
                        job.status === "complete" &&
                        job.audioUrl &&
                        job.audioUrl.includes(
                            "-ewe.mp3"
                        )
                    ) {

                        audioJob = job;
                    }
                }
            }

            if (
                !sourceJob ||
                !sourceJob.sourceVideoPath
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Vidéo originale introuvable."
                });
            }

            if (
                !audioJob ||
                !audioJob.audioUrl ||
                audioJob.status !== "complete"
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Audio Éwé synchronisé introuvable."
                });
            }

            const audioPath =
                path.join(
                    OUTPUT_DIR,
                    path.basename(
                        audioJob.audioUrl
                    )
                );

            if (
                !fs.existsSync(audioPath)
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Fichier audio Éwé introuvable."
                });
            }

            const jobId =
                crypto.randomUUID();

            const outputVideo =
                path.join(
                    OUTPUT_DIR,
                    `${jobId}-ewe-video.mp4`
                );

            jobs.set(jobId, {
                status: "processing",
                progress: 10,
                stage: "preparing",
                videoUrl: null,
                done: false,
                error: null
            });

            const finalJob =
                jobs.get(jobId);

            finalJob.progress = 25;
            finalJob.stage =
                "applying_ewe_audio";

            execFile(
                "ffmpeg",
                [
                    "-y",

                    "-i",
                    sourceJob.sourceVideoPath,

                    "-i",
                    audioPath,

                    /*
                     * Vidéo originale uniquement.
                     */
                    "-map",
                    "0:v:0",

                    /*
                     * Audio Éwé uniquement.
                     */
                    "-map",
                    "1:a:0",

                    /*
                     * Vidéo copiée sans réencodage.
                     */
                    "-c:v",
                    "copy",

                    /*
                     * Audio Éwé encodé en AAC.
                     */
                    "-c:a",
                    "aac",

                    "-b:a",
                    "192k",

                    /*
                     * Évite de dépasser la durée disponible.
                     */
                    "-shortest",

                    "-movflags",
                    "+faststart",

                    outputVideo
                ],

                (error, stdout, stderr) => {

                    if (error) {

                        finalJob.status =
                            "error";

                        finalJob.error =
                            stderr ||
                            error.message ||
                            "Impossible de créer la vidéo finale.";

                        finalJob.done = true;

                        return;
                    }

                    if (
                        !fs.existsSync(
                            outputVideo
                        )
                    ) {

                        finalJob.status =
                            "error";

                        finalJob.error =
                            "La vidéo finale n'a pas été créée.";

                        finalJob.done = true;

                        return;
                    }

                    finalJob.progress = 100;
                    finalJob.stage = "complete";
                    finalJob.status = "complete";
                    finalJob.done = true;

                    finalJob.videoUrl =
                        "/outputs/" +
                        path.basename(
                            outputVideo
                        );
                }
            );

            res.json({
                success: true,
                jobId,
                progress: 10,
                stage: "preparing"
            });

        } catch (error) {

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

app.get(
    "/api/apply-ewe-audio/:jobId",
    (req, res) => {

        const job =
            jobs.get(
                req.params.jobId
            );

        if (!job) {

            return res.status(404).json({
                success: false,
                error:
                    "Job vidéo introuvable."
            });
        }

        res.json({
            success: true,
            ...job
        });
    }
);

/*
 * ============================================================
 * DÉMARRAGE
 * ============================================================
 */

app.listen(
    PORT,
    () => {

        console.log(
            `EweVoice lancé sur le port ${PORT}`
        );
    }
);
