const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = 3000;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const OUTPUT_DIR = path.join(ROOT, "outputs");
const MODEL_DIR = path.join(ROOT, "models");
const VENV_PYTHON = path.join(ROOT, ".venv", "Scripts", "python.exe");

const FFMPEG_PATH =
    "C:\\Users\\hp\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe";

const WHISPER_MODEL =
    path.join(MODEL_DIR, "ggml-base.bin");

const TRANSLATE_SCRIPT =
    path.join(ROOT, "translate_srt.py");

for (const directory of [
    UPLOAD_DIR,
    OUTPUT_DIR,
    MODEL_DIR
]) {
    fs.mkdirSync(directory, { recursive: true });
}

app.use(express.json({ limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },

    filename: (req, file, cb) => {
        const extension = path.extname(file.originalname);
        const randomName =
            crypto.randomBytes(16).toString("hex");

        cb(null, `${randomName}${extension}`);
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 2 * 1024 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        if (
            file.mimetype &&
            file.mimetype.startsWith("video/")
        ) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    "Veuillez sélectionner un fichier vidéo."
                )
            );
        }
    }
});


/* =========================================================
   EXÉCUTER UN PROGRAMME
========================================================= */

function runProcess(command, args, options = {}) {

    return new Promise((resolve, reject) => {

        console.log("");
        console.log("=================================");
        console.log("PROCESSUS");
        console.log("=================================");
        console.log(command);
        console.log(args.join(" "));

        const child = spawn(
            command,
            args,
            {
                windowsHide: true,
                ...options
            }
        );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", data => {
            stdout += data.toString();
        });

        child.stderr.on("data", data => {
            stderr += data.toString();
            console.log(data.toString());
        });

        child.on("error", error => {
            reject(error);
        });

        child.on("close", code => {

            if (code === 0) {

                resolve({
                    stdout,
                    stderr
                });

            } else {

                reject(
                    new Error(
                        `Processus terminé avec le code ${code}\n${stderr}`
                    )
                );

            }

        });

    });

}


/* =========================================================
   FFMPEG
========================================================= */

function runFFmpeg(args) {
    return runProcess(FFMPEG_PATH, args);
}


/* =========================================================
   EXTRACTION AUDIO
========================================================= */

async function extractAudio(videoPath, audioPath) {

    await runFFmpeg([

        "-y",

        "-i",
        videoPath,

        "-vn",

        "-ac",
        "1",

        "-ar",
        "16000",

        "-c:a",
        "pcm_s16le",

        audioPath

    ]);

}


/* =========================================================
   WHISPER
========================================================= */

async function transcribeAudio(audioPath, outputSrt) {

    if (!fs.existsSync(WHISPER_MODEL)) {

        throw new Error(
            `Modèle Whisper introuvable : ${WHISPER_MODEL}`
        );

    }

    await runFFmpeg([

        "-y",

        "-i",
        audioPath,

        "-af",

        `whisper=model='${WHISPER_MODEL.replace(/\\/g, "/")}':language=en:destination='${outputSrt.replace(/\\/g, "/")}':format=srt`,

        "-f",
        "null",

        "NUL"

    ]);

    if (!fs.existsSync(outputSrt)) {

        throw new Error(
            "Whisper n'a pas généré le fichier SRT."
        );

    }

}


/* =========================================================
   TRANSCRIPTION VIDÉO
========================================================= */

app.post(
    "/api/transcribe",
    upload.single("video"),
    async (req, res) => {

        let videoPath = null;
        let audioPath = null;
        let srtPath = null;

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    error: "Aucune vidéo reçue."
                });

            }

            videoPath = req.file.path;

            const id =
                path.basename(
                    req.file.filename,
                    path.extname(req.file.filename)
                );

            audioPath =
                path.join(
                    OUTPUT_DIR,
                    `${id}.wav`
                );

            srtPath =
                path.join(
                    OUTPUT_DIR,
                    `${id}.srt`
                );

            console.log("");
            console.log("🎬 Vidéo reçue :", req.file.originalname);

            console.log("🎧 Extraction audio...");

            await extractAudio(
                videoPath,
                audioPath
            );

            console.log("🧠 Transcription anglaise...");

            await transcribeAudio(
                audioPath,
                srtPath
            );

            const srt =
                fs.readFileSync(
                    srtPath,
                    "utf8"
                );

            console.log("✅ Transcription terminée.");

            res.json({

                success: true,

                message:
                    "Transcription anglaise terminée.",

                filename:
                    path.basename(srtPath),

                subtitles:
                    srt

            });

        } catch (error) {

            console.error("❌ ERREUR TRANSCRIPTION");
            console.error(error);

            res.status(500).json({

                success: false,

                error:
                    error.message ||
                    "Erreur pendant la transcription."

            });

        } finally {

            if (
                videoPath &&
                fs.existsSync(videoPath)
            ) {
                try {
                    fs.unlinkSync(videoPath);
                } catch {}
            }

            if (
                audioPath &&
                fs.existsSync(audioPath)
            ) {
                try {
                    fs.unlinkSync(audioPath);
                } catch {}
            }

        }

    }
);


/* =========================================================
   TRADUCTION SRT ANGLAIS → ÉWÉ
========================================================= */

function translateSRT(subtitles) {

    return new Promise((resolve, reject) => {

        if (!fs.existsSync(VENV_PYTHON)) {

            return reject(
                new Error(
                    `Python virtuel introuvable : ${VENV_PYTHON}`
                )
            );

        }

        if (!fs.existsSync(TRANSLATE_SCRIPT)) {

            return reject(
                new Error(
                    `Script de traduction introuvable : ${TRANSLATE_SCRIPT}`
                )
            );

        }

        const input =
            JSON.stringify(subtitles);

        const child =
            spawn(
                VENV_PYTHON,
                [TRANSLATE_SCRIPT],
                {
                    windowsHide: true
                }
            );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", data => {
            stdout += data.toString();
        });

        child.stderr.on("data", data => {
            stderr += data.toString();
            console.log(data.toString());
        });

        child.on("error", error => {
            reject(error);
        });

        child.on("close", code => {

            if (code !== 0) {

                return reject(
                    new Error(
                        `NLLB a échoué avec le code ${code}\n${stderr}`
                    )
                );

            }

            try {

                const result =
                    JSON.parse(stdout);

                resolve(result);

            } catch (error) {

                reject(
                    new Error(
                        `Réponse NLLB invalide.\n${stdout}\n${stderr}`
                    )
                );

            }

        });

        child.stdin.write(input);
        child.stdin.end();

    });

}


/* =========================================================
   PARSER SRT
========================================================= */

function parseSRT(content) {

    const blocks =
        content
            .replace(/\r/g, "")
            .trim()
            .split(/\n\s*\n/);

    const subtitles = [];

    for (const block of blocks) {

        const lines =
            block.split("\n");

        if (lines.length < 2) {
            continue;
        }

        let timeLineIndex = 0;

        if (/^\d+$/.test(lines[0].trim())) {
            timeLineIndex = 1;
        }

        const timeLine =
            lines[timeLineIndex];

        if (
            !timeLine ||
            !timeLine.includes("-->")
        ) {
            continue;
        }

        const times =
            timeLine.split("-->");

        const start =
            times[0].trim();

        const end =
            times[1].trim();

        const text =
            lines
                .slice(timeLineIndex + 1)
                .join(" ")
                .replace(/<[^>]*>/g, "")
                .trim();

        if (!text) {
            continue;
        }

        subtitles.push({
            start,
            end,
            text
        });

    }

    return subtitles;

}


/* =========================================================
   CRÉER SRT
========================================================= */

function createSRT(subtitles) {

    return subtitles
        .map((subtitle, index) => {

            return [
                index + 1,
                `${subtitle.start} --> ${subtitle.end}`,
                subtitle.text,
                ""
            ].join("\n");

        })
        .join("\n");

}


/* =========================================================
   API TRADUCTION
========================================================= */

app.post(
    "/api/translate",
    async (req, res) => {

        try {

            let subtitles =
                req.body.subtitles;

            if (!subtitles) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Aucun sous-titre fourni."

                });

            }

            if (typeof subtitles === "string") {

                subtitles =
                    parseSRT(subtitles);

            }

            if (!Array.isArray(subtitles)) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Format de sous-titres invalide."

                });

            }

            if (subtitles.length === 0) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Aucun dialogue à traduire."

                });

            }

            console.log("");
            console.log("=================================");
            console.log("🇬🇧 → 🇹🇬 TRADUCTION NLLB");
            console.log("=================================");
            console.log(
                `${subtitles.length} dialogues à traduire.`
            );

            const translated =
                await translateSRT(subtitles);

            const srtEwe =
                createSRT(translated);

            const filename =
                `ewe-${crypto.randomBytes(8).toString("hex")}.srt`;

            const outputPath =
                path.join(
                    OUTPUT_DIR,
                    filename
                );

            fs.writeFileSync(
                outputPath,
                srtEwe,
                "utf8"
            );

            console.log("✅ Traduction Éwé terminée.");

            res.json({

                success: true,

                message:
                    "Traduction Anglais → Éwé terminée.",

                filename,

                subtitles:
                    translated,

                srt:
                    srtEwe

            });

        } catch (error) {

            console.error("❌ ERREUR TRADUCTION");
            console.error(error);

            res.status(500).json({

                success: false,

                error:
                    error.message ||
                    "Erreur pendant la traduction."

            });

        }

    }
);


/* =========================================================
   API STATUS
========================================================= */

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            success: true,

            application:
                "EweVoice",

            whisper:
                fs.existsSync(
                    WHISPER_MODEL
                ),

            ffmpeg:
                fs.existsSync(
                    FFMPEG_PATH
                ),

            python:
                fs.existsSync(
                    VENV_PYTHON
                ),

            nllb:
                fs.existsSync(
                    TRANSLATE_SCRIPT
                )

        });

    }
);


/* =========================================================
   ERREURS
========================================================= */

app.use(
    (error, req, res, next) => {

        console.error(error);

        if (
            error instanceof multer.MulterError
        ) {

            return res.status(400).json({

                success: false,

                error:
                    `Erreur upload : ${error.message}`

            });

        }

        res.status(500).json({

            success: false,

            error:
                error.message ||
                "Erreur serveur."

        });

    }
);


/* =========================================================
   SERVEUR
========================================================= */

app.listen(
    PORT,
    () => {

        console.log("");
        console.log("=================================");
        console.log("       EWEVOICE DEMARRE");
        console.log("=================================");
        console.log(
            `Site : http://localhost:${PORT}`
        );

        console.log(
            `FFmpeg : ${
                fs.existsSync(FFMPEG_PATH)
                    ? "OK"
                    : "INTROUVABLE"
            }`
        );

        console.log(
            `Whisper : ${
                fs.existsSync(WHISPER_MODEL)
                    ? "OK"
                    : "INTROUVABLE"
            }`
        );

        console.log(
            `Python : ${
                fs.existsSync(VENV_PYTHON)
                    ? "OK"
                    : "INTROUVABLE"
            }`
        );

        console.log(
            `NLLB : ${
                fs.existsSync(TRANSLATE_SCRIPT)
                    ? "OK"
                    : "INTROUVABLE"
            }`
        );

        console.log("");

    }
);
