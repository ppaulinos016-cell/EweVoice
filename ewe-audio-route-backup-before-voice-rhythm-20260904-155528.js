const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BASE_DIR = __dirname;

const PYTHON = process.platform === "win32"
    ? path.join(BASE_DIR, ".venv", "Scripts", "python.exe")
    : path.join(BASE_DIR, ".venv", "bin", "python");

const TRANSLATE = path.join(BASE_DIR, "translate_srt.py");
const DUB = path.join(BASE_DIR, "dub_ewe.py");

function parseTime(value) {
    const parts = value.trim().replace(",", ".").split(":");

    if (parts.length !== 3) {
        return NaN;
    }

    return (
        Number(parts[0]) * 3600 +
        Number(parts[1]) * 60 +
        Number(parts[2])
    );
}

function parseSRT(content) {
    const normalized = String(content)
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();

    if (!normalized) {
        return [];
    }

    const blocks = normalized.split(/\n\s*\n/);
    const segments = [];

    for (const block of blocks) {
        const lines = block
            .split("\n")
            .map(line => line.trimEnd());

        if (lines.length < 3) {
            continue;
        }

        const timeLineIndex = lines.findIndex(line => line.includes("-->"));

        if (timeLineIndex === -1) {
            continue;
        }

        const times = lines[timeLineIndex].split(/\s+-->\s+/);

        if (times.length !== 2) {
            continue;
        }

        const start = parseTime(times[0]);
        const end = parseTime(times[1]);

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            continue;
        }

        const text = lines
            .slice(timeLineIndex + 1)
            .join(" ")
            .trim();

        if (!text) {
            continue;
        }

        segments.push({
            id: segments.length + 1,
            start,
            end,
            text
        });
    }

    return segments;
}

function writeSegmentsFromSRT(srtPath, jsonPath) {
    const content = fs.readFileSync(srtPath, "utf8");
    const segments = parseSRT(content);

    fs.writeFileSync(
        jsonPath,
        JSON.stringify(segments, null, 2),
        "utf8"
    );

    return segments;
}

function startEweAudioTranslation({
    subtitles,
    sourceLanguage,
    outputDir,
    job
}) {
    return new Promise((resolve, reject) => {

        if (!Array.isArray(subtitles) || subtitles.length === 0) {
            reject(new Error("Aucune transcription disponible."));
            return;
        }

        const id =
            Date.now().toString(36) +
            "-" +
            Math.random().toString(36).slice(2, 8);

        const inputSrt = path.join(
            outputDir,
            `${id}-original.srt`
        );

        const eweSrt = path.join(
            outputDir,
            `${id}-ewe.srt`
        );

        const segmentsJson = path.join(
            outputDir,
            `${id}-segments.json`
        );

        const eweAudio = path.join(
            outputDir,
            `${id}-ewe.mp3`
        );

        function time(seconds) {
            const ms = Math.max(
                0,
                Math.round(Number(seconds) * 1000)
            );

            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            const s = Math.floor((ms % 60000) / 1000);
            const milli = ms % 1000;

            return (
                String(h).padStart(2, "0") +
                ":" +
                String(m).padStart(2, "0") +
                ":" +
                String(s).padStart(2, "0") +
                "," +
                String(milli).padStart(3, "0")
            );
        }

        const srt = subtitles
            .map((segment, index) => {
                return (
                    `${index + 1}\n` +
                    `${time(segment.start)} --> ${time(segment.end)}\n` +
                    `${String(segment.text || "").trim()}\n`
                );
            })
            .join("\n");

        fs.writeFileSync(
            inputSrt,
            srt,
            "utf8"
        );

        job.progress = 10;
        job.stage = "translation";

        const translator = spawn(
            PYTHON,
            [
                TRANSLATE,
                inputSrt,
                eweSrt,
                sourceLanguage || "eng_Latn",
                "ewe_Latn"
            ],
            {
                windowsHide: true
            }
        );

        let stderr = "";

        translator.stderr.on("data", data => {
            stderr += data.toString();
        });

        translator.stdout.on("data", data => {
            const lines = data
                .toString()
                .split(/\r?\n/);

            for (const line of lines) {
                if (!line.trim()) {
                    continue;
                }

                try {
                    const event = JSON.parse(line);

                    if (event.type === "progress") {
                        job.progress = Math.min(
                            50,
                            10 +
                            Math.round(
                                Number(event.progress || 0) * 0.4
                            )
                        );
                    }
                } catch {}
            }
        });

        translator.on("error", error => {
            reject(error);
        });

        translator.on("close", code => {

            if (code !== 0) {
                reject(
                    new Error(
                        stderr ||
                        `Traduction arrêtée avec le code ${code}.`
                    )
                );
                return;
            }

            if (!fs.existsSync(eweSrt)) {
                reject(
                    new Error(
                        "Le fichier de traduction Éwé n'a pas été créé."
                    )
                );
                return;
            }

            try {
                const segments = writeSegmentsFromSRT(
                    eweSrt,
                    segmentsJson
                );

                if (!segments.length) {
                    reject(
                        new Error(
                            "La traduction Éwé existe, mais aucun segment n'a pu être lu dans le SRT."
                        )
                    );
                    return;
                }

                console.log(
                    `Segments Éwé préparés : ${segments.length}`
                );

            } catch (error) {
                reject(error);
                return;
            }

            job.progress = 55;
            job.stage = "ewe_audio";

            const totalDuration = subtitles.reduce(
                (max, segment) =>
                    Math.max(
                        max,
                        Number(segment.end) || 0
                    ),
                0
            );

            job.progress = 60;
            job.stage = "synchronization";

            const dubbing = spawn(
                PYTHON,
                [
                    DUB,
                    segmentsJson,
                    eweAudio,
                    String(totalDuration)
                ],
                {
                    windowsHide: true
                }
            );

            let dubError = "";

            dubbing.stderr.on("data", data => {
                dubError += data.toString();
            });

            dubbing.stdout.on("data", data => {
                const text = data.toString();

                if (
                    text.includes("VOIX EWE") ||
                    text.includes('"success"')
                ) {
                    job.progress = 95;
                    job.stage = "audio_ready";
                }
            });

            dubbing.on("error", error => {
                reject(error);
            });

            dubbing.on("close", dubCode => {

                if (dubCode !== 0) {
                    reject(
                        new Error(
                            dubError ||
                            "Erreur pendant la génération audio Éwé."
                        )
                    );
                    return;
                }

                if (!fs.existsSync(eweAudio)) {
                    reject(
                        new Error(
                            "Le fichier audio Éwé n'a pas été créé."
                        )
                    );
                    return;
                }

                job.progress = 100;
                job.stage = "complete";
                job.audioUrl =
                    "/outputs/" +
                    path.basename(eweAudio);
                job.status = "complete";
                job.done = true;

                resolve({
                    audioPath: eweAudio,
                    audioUrl: job.audioUrl
                });
            });
        });
    });
}

module.exports = {
    startEweAudioTranslation
};
