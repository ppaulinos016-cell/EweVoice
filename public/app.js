const videoInput = document.getElementById("videoInput");
const videoContainer = document.getElementById("videoContainer");
const videoInfo = document.getElementById("videoInfo");
const processButton = document.getElementById("processButton");
const status = document.getElementById("status");
const voiceType = document.getElementById("voiceType");
const targetLanguage = document.getElementById("targetLanguage");
const resultSection = document.getElementById("resultSection");
const resultVideo = document.getElementById("resultVideo");
const downloadButton = document.getElementById("downloadButton");

let selectedVideo = null;

videoInput.addEventListener("change", () => {

    const file = videoInput.files[0];

    if (!file) {
        selectedVideo = null;
        processButton.disabled = true;
        return;
    }

    selectedVideo = file;

    videoContainer.innerHTML = "";

    const video = document.createElement("video");

    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.src = URL.createObjectURL(file);

    videoContainer.appendChild(video);

    videoInfo.textContent =
        `Vidéo sélectionnée : ${file.name}`;

    status.innerHTML = `
        <div class="progress-wrapper">
            <div class="progress-title">✅ Vidéo prête</div>
            <div class="progress-text">
                Choisissez la langue et la voix, puis lancez la traduction.
            </div>
        </div>
    `;

    processButton.disabled = false;

    if (resultSection) {
        resultSection.style.display = "none";
    }
});


function afficherProgression(etape, titre, message, pourcentage) {

    status.innerHTML = `

        <div class="progress-wrapper">

            <div class="progress-header">
                <strong>${etape}</strong>
                <span>${pourcentage}%</span>
            </div>

            <div class="progress-bar">
                <div
                    class="progress-fill"
                    style="width:${pourcentage}%"
                ></div>
            </div>

            <div class="progress-title">
                ${titre}
            </div>

            <div class="progress-text">
                ${message}
            </div>

        </div>
    `;
}


processButton.addEventListener("click", async () => {

    if (!selectedVideo) {
        status.textContent =
            "⚠️ Sélectionnez une vidéo.";
        return;
    }

    processButton.disabled = true;

    const selectedVoice =
        voiceType?.value || "adult";

    const selectedLanguage =
        targetLanguage?.value || "fr";

    const formData = new FormData();

    formData.append("video", selectedVideo);
    formData.append("voice", selectedVoice);
    formData.append("targetLanguage", selectedLanguage);


    afficherProgression(
        "1/4",
        "🧠 Analyse de la vidéo",
        "Extraction de la piste audio et transcription de la parole...",
        25
    );


    try {

        const response = await fetch(
            "/api/dub-video",
            {
                method: "POST",
                body: formData
            }
        );


        if (!response.ok) {

            let errorMessage =
                "La traduction a échoué.";

            try {

                const errorData =
                    await response.json();

                errorMessage =
                    errorData.error || errorMessage;

            } catch (_) {}

            throw new Error(errorMessage);
        }


        /*
         * Le serveur effectue actuellement
         * les différentes opérations avant
         * de retourner le résultat final.
         *
         * L'interface présente donc les étapes
         * pendant le traitement de la réponse.
         */

        afficherProgression(
            "2/4",
            "🌍 Traduction",
            `Traduction automatique vers ${
                selectedLanguage === "fr"
                    ? "le français"
                    : "l'éwé"
            }...`,
            50
        );


        const data = await response.json();


        if (!data.success) {

            throw new Error(
                data.error ||
                "La traduction a échoué."
            );
        }


        afficherProgression(
            "3/4",
            "🎙️ Génération de la voix",
            "Création de la nouvelle piste audio avec la voix sélectionnée...",
            75
        );


        await new Promise(
            resolve => setTimeout(resolve, 500)
        );


        afficherProgression(
            "4/4",
            "🎬 Création de la vidéo finale",
            "Remplacement de l'audio original et finalisation de la vidéo...",
            90
        );


        if (!data.video) {

            throw new Error(
                "La vidéo finale n'a pas été retournée par le serveur."
            );
        }


        afficherResultat(data.video);


        afficherProgression(
            "✓",
            "🎉 Traduction terminée",
            "La vidéo est prête. Vous pouvez maintenant la regarder ou la télécharger.",
            100
        );


    } catch (error) {

        console.error(error);

        status.innerHTML = `
            <div class="error-message">
                ❌ ${error.message}
            </div>
        `;

    } finally {

        processButton.disabled = false;

    }

});


function afficherResultat(videoURL) {

    if (!resultSection ||
        !resultVideo ||
        !downloadButton) {

        return;
    }


    resultSection.style.display = "block";


    resultVideo.src = videoURL;


    downloadButton.href = videoURL;

    downloadButton.download =
        "EweVoice-video-traduite.mp4";


    resultSection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

}
