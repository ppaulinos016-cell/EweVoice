const videoInput = document.getElementById("videoInput");
const videoContainer = document.getElementById("videoContainer");
const videoInfo = document.getElementById("videoInfo");
const processButton = document.getElementById("processButton");
const status = document.getElementById("status");
const subtitleStatus = document.getElementById("subtitleStatus");
const subtitleText = document.getElementById("subtitleText");
const voiceType = document.getElementById("voiceType");

let selectedVideo = null;

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
        `Vidéo sélectionnée : ${file.name} (${formatFileSize(file.size)})`;

    subtitleStatus.textContent =
        "Vidéo chargée. Recherche des sous-titres en préparation...";

    subtitleText.textContent =
        "Les sous-titres anglais seront traités dans la prochaine étape.";

    processButton.disabled = false;

    status.textContent =
        "✅ Vidéo prête pour le traitement.";

});

processButton.addEventListener("click", () => {

    if (!selectedVideo) {
        return;
    }

    status.textContent =
        "🎬 Préparation du doublage en cours...";

});

voiceType.addEventListener("change", () => {

    const selected =
        voiceType.options[voiceType.selectedIndex].text;

    status.textContent =
        `Voix sélectionnée : ${selected}`;

});

function formatFileSize(bytes) {

    if (bytes < 1024) {
        return bytes + " octets";
    }

    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(1) + " Ko";
    }

    return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
}
