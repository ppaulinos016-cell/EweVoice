const videoInput = document.getElementById("videoInput");
const subtitleInput = document.getElementById("subtitleInput");

const videoContainer = document.getElementById("videoContainer");
const videoInfo = document.getElementById("videoInfo");

const subtitleStatus = document.getElementById("subtitleStatus");
const subtitleText = document.getElementById("subtitleText");

const processButton = document.getElementById("processButton");
const status = document.getElementById("status");

const voiceType = document.getElementById("voiceType");

let selectedVideo = null;
let selectedSubtitles = [];


/* ================================
   VIDÉO
================================ */

videoInput.addEventListener("change", () => {

    const file = videoInput.files[0];

    if (!file) {
        return;
    }

    selectedVideo = file;

    const videoURL = URL.createObjectURL(file);

    videoContainer.innerHTML = "";

    const video = document.createElement("video");

    video.controls = true;
    video.preload = "metadata";
    video.src = videoURL;

    videoContainer.appendChild(video);

    videoInfo.textContent =
        `Vidéo : ${file.name} — ${formatFileSize(file.size)}`;

    status.textContent =
        "✅ Vidéo chargée.";

    updateProcessButton();
});


/* ================================
   SOUS-TITRES
================================ */

subtitleInput.addEventListener("change", async () => {

    const file = subtitleInput.files[0];

    if (!file) {
        return;
    }

    subtitleStatus.textContent =
        `Lecture du fichier : ${file.name}`;

    try {

        const content = await file.text();

        const extension =
            file.name.toLowerCase().split(".").pop();

        if (extension === "srt") {

            selectedSubtitles = parseSRT(content);

        } else if (extension === "vtt") {

            selectedSubtitles = parseVTT(content);

        } else {

            throw new Error("Format de sous-titres non reconnu.");

        }

        displaySubtitles(selectedSubtitles);

        subtitleStatus.textContent =
            `✅ ${selectedSubtitles.length} sous-titres détectés.`;

        status.textContent =
            "✅ Sous-titres anglais chargés.";

        updateProcessButton();

    } catch (error) {

        console.error(error);

        subtitleStatus.textContent =
            "❌ Impossible de lire les sous-titres.";

        subtitleText.textContent =
            "Vérifiez que le fichier est bien au format SRT ou VTT.";

    }

});


/* ================================
   LECTURE SRT
================================ */

function parseSRT(content) {

    const blocks = content
        .replace(/\r/g, "")
        .trim()
        .split(/\n\s*\n/);

    const subtitles = [];

    for (const block of blocks) {

        const lines = block.split("\n");

        if (lines.length < 2) {
            continue;
        }

        let timeLineIndex = 0;

        if (/^\d+$/.test(lines[0].trim())) {
            timeLineIndex = 1;
        }

        const timeLine = lines[timeLineIndex];

        if (!timeLine || !timeLine.includes("-->")) {
            continue;
        }

        const times = timeLine.split("-->");

        const start = times[0].trim();
        const end = times[1].trim();

        const text = lines
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


/* ================================
   LECTURE VTT
================================ */

function parseVTT(content) {

    const blocks = content
        .replace(/\r/g, "")
        .trim()
        .split(/\n\s*\n/);

    const subtitles = [];

    for (const block of blocks) {

        const lines = block.split("\n");

        const timeLineIndex =
            lines.findIndex(line => line.includes("-->"));

        if (timeLineIndex === -1) {
            continue;
        }

        const timeLine = lines[timeLineIndex];

        const times = timeLine.split("-->");

        const start = times[0].trim();
        const end = times[1].trim();

        const text = lines
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


/* ================================
   AFFICHAGE
================================ */

function displaySubtitles(subtitles) {

    subtitleText.innerHTML = "";

    if (subtitles.length === 0) {

        subtitleText.textContent =
            "Aucun dialogue trouvé.";

        return;
    }

    subtitles.forEach((subtitle, index) => {

        const row = document.createElement("div");

        row.className = "subtitle-row";

        row.innerHTML = `
            <strong>${index + 1}.</strong>
            <span class="subtitle-time">
                ${escapeHTML(subtitle.start)}
                →
                ${escapeHTML(subtitle.end)}
            </span>
            <span class="subtitle-dialogue">
                ${escapeHTML(subtitle.text)}
            </span>
        `;

        subtitleText.appendChild(row);

    });

}


/* ================================
   BOUTON DOUBLAGE
================================ */

processButton.addEventListener("click", () => {

    if (!selectedVideo) {
        return;
    }

    if (selectedSubtitles.length === 0) {

        status.textContent =
            "⚠️ Aucun sous-titre anglais disponible.";

        return;
    }

    status.textContent =
        `✅ ${selectedSubtitles.length} dialogues prêts pour la traduction Anglais → Éwé.`;

});


/* ================================
   CHOIX DE VOIX
================================ */

voiceType.addEventListener("change", () => {

    const selected =
        voiceType.options[voiceType.selectedIndex].text;

    status.textContent =
        `Voix sélectionnée : ${selected}`;

});


/* ================================
   UTILITAIRES
================================ */

function updateProcessButton() {

    processButton.disabled =
        !selectedVideo || selectedSubtitles.length === 0;

}


function formatFileSize(bytes) {

    if (bytes < 1024) {
        return `${bytes} octets`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} Ko`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}


function escapeHTML(text) {

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}
