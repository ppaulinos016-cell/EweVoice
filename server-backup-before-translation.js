
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

const FFMPEG_PATH =
    "C:\\Users\\hp\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe";

const WHISPER_MODEL =
    path.join(MODEL_DIR, "ggml-base.bin");


/* =========================================================
   DOSSIERS
========================================================= */

for (const directory of [
    UPLOAD_DIR,
    OUTPUT_DIR,
    MODEL_DIR
]) {
    fs.mkdirSync(directory, {
        recursive: true
    });
}


/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json());

app.use(express.static(PUBLIC_DIR));


/* =========================================================
   UPLOAD
========================================================= */

const storage = multer.diskStorage({

    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },

    filename: (req, file, cb) => {

        const extension =
            path.extname(file.originalname);

        const randomName =
            crypto.randomBytes(16).toString("hex");

        cb(
            null,
            `${randomName}${extension}`
        );
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
   UTILITAIRE : EXECUTER FFMPEG
========================================================= */

function runFFmpeg(args) {

    return new Promise((resolve, reject) => {

        console.log("");
        console.log("=================================");
        console.log("FFMPEG");
        console.log("=================================");
        console.log(args.join(" "));

        const process = spawn(
            FFMPEG_PATH,
            args,
            {
                windowsHide: true
            }
        );

        let stderr = "";
        let stdout = "";

        process.stdout.on(
            "data",
            data => {
                stdout += data.toString();
            }
        );

        process.stderr.on(
            "data",
            data => {
                stderr += data.toString();
                console.log(data.toString());
            }
        );

        process.on(
            "error",
            error => {
                reject(error);
            }
        );

        process.on(
            "close",
            code => {

                if (code === 0) {

                    resolve({
                        stdout,
                        stderr
                    });

                } else {

                    reject(
                        new Error(
                            `FFmpeg a échoué avec le code ${code}\n${stderr}`
                        )
                    );

                }

            }
        );

    });

}


/* =========================================================
   EXTRAIRE AUDIO
========================================================= */

async function extractAudio(
    videoPath,
    audioPath
) {

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
   TRANSCRIPTION WHISPER
========================================================= */

async function transcribeAudio(
    audioPath,
    outputSrt
) {

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
   API TRANSCRIPTION
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


            videoPath =
                req.file.path;


            const id =
                path.basename(
                    req.file.filename,
                    path.extname(
                        req.file.filename
                    )
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
            console.log(
                "🎬 Vidéo reçue :",
                req.file.originalname
            );


            /* -----------------------------
               EXTRACTION AUDIO
            ----------------------------- */

            console.log(
                "🎧 Extraction audio..."
            );

            await extractAudio(
                videoPath,
                audioPath
            );


            /* -----------------------------
               WHISPER
            ----------------------------- */

            console.log(
                "🧠 Transcription anglaise..."
            );

            await transcribeAudio(
                audioPath,
                srtPath
            );


            /* -----------------------------
               LECTURE SRT
            ----------------------------- */

            const srt =
                fs.readFileSync(
                    srtPath,
                    "utf8"
                );


            console.log("");
            console.log(
                "✅ Transcription terminée."
            );


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

            console.error("");
            console.error(
                "❌ ERREUR TRANSCRIPTION"
            );

            console.error(error);


            res.status(500).json({

                success: false,

                error:
                    error.message ||
                    "Erreur pendant la transcription."

            });


        } finally {

            /* -----------------------------
               SUPPRESSION VIDÉO TEMPORAIRE
            ----------------------------- */

            if (
                videoPath &&
                fs.existsSync(videoPath)
            ) {

                try {
                    fs.unlinkSync(videoPath);
                } catch {}

            }


            /* -----------------------------
               SUPPRESSION AUDIO
            ----------------------------- */

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
   API ETAT
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
                )

        });

    }
);


/* =========================================================
   GESTION DES ERREURS MULTER
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
        console.log(
            "================================="
        );

        console.log(
            "       EWEVOICE DEMARRE"
        );

        console.log(
            "================================="
        );

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

        console.log("");

    }
);