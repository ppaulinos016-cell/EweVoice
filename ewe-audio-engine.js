const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");

const BASE = __dirname;
const UPLOAD_DIR = path.join(BASE, "uploads");
const OUTPUT_DIR = path.join(BASE, "outputs");
const PYTHON = process.platform === "win32"
    ? path.join(BASE, ".venv", "Scripts", "python.exe")
    : path.join(BASE, ".venv", "bin", "python");

function run(command, args) {
    return new Promise((resolve, reject) => {
        execFile(command, args, {
            windowsHide: true,
            maxBuffer: 20 * 1024 * 1024
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || stdout || error.message));
                return;
            }
            resolve(stdout);
        });
    });
}

function formatSrtTime(seconds) {
    const ms = Math.max(0, Math.round(Number(seconds) * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;

    return (
        String(h).padStart(2, "0") + ":" +
        String(m).padStart(2, "0") + ":" +
        String(s).padStart(2, "0") + "," +
        String(milli).padStart(3, "0")
    );
}

function writeSrt(segments, file) {
    const content = segments.map((s, i) =>
        `${i + 1}
${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}
${String(s.text || "").trim()}
`
    ).join("\n");

    fs.writeFileSync(file, content, "utf8");
}

function parseSrt(content) {
    const blocks = content.trim().split(/\r?\n\r?\n/);
    const result = [];

    function time(v) {
        const p = v.replace(",", ".").split(":");
        return Number(p[0]) * 3600 +
               Number(p[1]) * 60 +
               Number(p[2]);
    }

    for (let i = 0; i < blocks.length; i++) {
        const lines = blocks[i].split(/\r?\n/);
        if (lines.length < 3 || !lines[1].includes("-->")) continue;

        const t = lines[1].split(/\s+-->\s+/);

        result.push({
            id: i + 1,
            start: time(t[0]),
            end: time(t[1]),
            text: lines.slice(2).join(" ").trim()
        });
    }

    return result;
}

function pythonTranslate(inputSrt, outputSrt, sourceLanguage) {
    return new Promise((resolve, reject) => {
        const child = spawn(PYTHON, [
            path.join(BASE, "translate_srt.py"),
            inputSrt,
            outputSrt,
            sourceLanguage || "eng_Latn",
            "ewe_Latn"
        ], {
            windowsHide: true
        });

        let stderr = "";

        child.stderr.on("data", d => {
            stderr += d.toString();
        });

        child.on("error", reject);

        child.on("close", code => {
            if (code !== 0) {
                reject(new Error(
                    stderr || `Traduction arrêtée avec le code ${code}.`
                ));
                return;
            }

            resolve();
        });
    });
}

async function main() {
    console.log("Moteur de traduction audio Éwé prêt.");
    console.log("Python :", PYTHON);
    console.log("translate_srt.py :", path.join(BASE, "translate_srt.py"));
    console.log("dub_ewe.py :", path.join(BASE, "dub_ewe.py"));
    console.log("Dossiers outputs/uploads vérifiés.");

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
