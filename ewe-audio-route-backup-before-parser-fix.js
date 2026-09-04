const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BASE_DIR = __dirname;
const PYTHON = process.platform === "win32"
    ? path.join(BASE_DIR, ".venv", "Scripts", "python.exe")
    : path.join(BASE_DIR, ".venv", "bin", "python.exe");

const TRANSLATE = path.join(BASE_DIR, "translate_srt.py");
const DUB = path.join(BASE_DIR, "dub_ewe.py");

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

        const id = Date.now().toString(36) +
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

        const srt = subtitles.map((segment, index) => {
            return (
                `${index + 1}\n` +
                `${time(segment.start)} --> ${time(segment.end)}\n` +
                `${String(segment.text || "").trim()}\n`
            );
        }).join("\n");

        fs.writeFileSync(inputSrt, srt, "utf8");

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
            const lines = data.toString().split(/\r?\n/);

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const event = JSON.parse(line);

                    if (event.type === "progress") {
                        job.progress = Math.min(
                            50,
                            10 + Math.round(
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
                reject(new Error(
                    stderr ||
                    `Traduction arrêtée avec le code ${code}.`
                ));
                return;
            }

            if (!fs.existsSync(eweSrt)) {
                reject(new Error(
                    "Le fichier de traduction Éwé n'a pas été créé."
                ));
                return;
            }

            job.progress = 55;
            job.stage = "ewe_audio";

            const parseSrt = require("child_process").spawn(
                process.execPath,
                [
                    "-e",
                    `
const fs = require("fs");

const input = process.argv[1];
const output = process.argv[2];

const content = fs.readFileSync(input, "utf8");
const blocks = content.trim().split(/\\\\r?\\\\n\\\\r?\\\\n/);

function parseTime(v) {
    const p = v.replace(",", ".").split(":");
    return Number(p[0]) * 3600 +
           Number(p[1]) * 60 +
           Number(p[2]);
}

const result = [];

for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split(/\\\\r?\\\\n/);

    if (lines.length < 3) continue;
    if (!lines[1].includes("-->")) continue;

    const times = lines[1].split(/\\\\s+-->\\\\s+/);

    result.push({
        id: i + 1,
        start: parseTime(times[0]),
        end: parseTime(times[1]),
        text: lines.slice(2).join(" ").trim()
    });
}

fs.writeFileSync(
    output,
    JSON.stringify(result, null, 2),
    "utf8"
);
`,
                    eweSrt,
                    segmentsJson
                ],
                {
                    windowsHide: true
                }
            );

            let parseError = "";

            parseSrt.stderr.on("data", data => {
                parseError += data.toString();
            });

            parseSrt.on("close", parseCode => {
                if (parseCode !== 0) {
                    reject(new Error(
                        parseError ||
                        "Impossible de préparer les segments Éwé."
                    ));
                    return;
                }

                if (!fs.existsSync(segmentsJson)) {
                    reject(new Error(
                        "Les segments Éwé n'ont pas été préparés."
                    ));
                    return;
                }

                job.progress = 60;
                job.stage = "synchronization";

                const totalDuration = subtitles.reduce(
                    (max, segment) =>
                        Math.max(max, Number(segment.end) || 0),
                    0
                );

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
                        text.includes("success")
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
                        reject(new Error(
                            dubError ||
                            "Erreur pendant la génération audio Éwé."
                        ));
                        return;
                    }

                    if (!fs.existsSync(eweAudio)) {
                        reject(new Error(
                            "Le fichier audio Éwé n'a pas été créé."
                        ));
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
    });
}

module.exports = {
    startEweAudioTranslation
};
