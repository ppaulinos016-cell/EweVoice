const videoInput = document.getElementById("videoInput");
const videoContainer = document.getElementById("videoContainer");
const videoInfo = document.getElementById("videoInfo");
const processButton = document.getElementById("processButton");
const status = document.getElementById("status");
const voiceType = document.getElementById("voiceType");

let selectedVideo = null;
let finalVideoURL = null;

videoInput.addEventListener("change", () => {
    const file = videoInput.files[0];

    if (!file) return;

    selectedVideo = file;
    finalVideoURL = null;

    videoContainer.innerHTML = "";

    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = URL.createObjectURL(file);

    videoContainer.appendChild(video);

    videoInfo.textContent =
        `Vidéo sélectionnée : ${file.name}`;

    status.textContent =
        "✅ Vidéo prête. Choisissez une voix puis cliquez sur « Traduire la vidéo ».";

    processButton.disabled = false;
});

processButton.addEventListener("click", async () => {

    if (!selectedVideo) {
        status.textContent = "⚠️ Sélectionnez une vidéo.";
        return;
    }

    processButton.disabled = true;

    const selectedVoice =
        voiceType?.value || "adult";

    status.textContent =
        "📤 Envoi de la vidéo...";

    const formData = new FormData();

    formData.append("video", selectedVideo);
    formData.append("voice", selectedVoice);

    try {

        status.textContent =
            "🧠 1/4 Analyse de la vidéo et transcription...";

        const response = await fetch(
            "/api/dub-video",
            {
                method: "POST",
                body: formData
            }
        );

        status.textContent =
            "🌍 2/4 Traduction des dialogues...";

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "La traduction a échoué."
            );
        }

        status.textContent =
            "🎙️ 3/4 Génération de la voix traduite...";

        await new Promise(resolve => setTimeout(resolve, 300));

        status.textContent =
            "🎬 4/4 Création de la vidéo finale...";

        if (!data.video) {
            throw new Error(
                "La vidéo finale n'a pas été retournée par le serveur."
            );
        }

        finalVideoURL = data.video;

        afficherResultat(data.video);

        status.textContent =
            "✅ Vidéo traduite terminée !";

    } catch (error) {

        console.error(error);

        status.textContent =
            `❌ ${error.message}`;

    } finally {

        processButton.disabled = false;

    }
});

function afficherResultat(videoURL) {

    videoContainer.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = "🎉 Vidéo traduite";

    const video = document.createElement("video");

    video.controls = true;
    video.preload = "metadata";
    video.src = videoURL;

    const download = document.createElement("a");

    download.href = videoURL;
    download.download = "EweVoice-video-traduite.mp4";
    download.textContent = "⬇️ Télécharger la vidéo traduite";
    download.className = "download-video";

    videoContainer.appendChild(title);
    videoContainer.appendChild(video);
    videoContainer.appendChild(download);
}