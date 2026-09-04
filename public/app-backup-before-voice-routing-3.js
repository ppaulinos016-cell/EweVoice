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

/* ===== EWEVOICE EXTRACTION FIX ===== */
(function () {
    function initExtractionFix() {
        const button = document.getElementById("extractButton");
        const videoInput = document.getElementById("videoInput");
        const sourceLanguage = document.getElementById("sourceLanguage");

        if (!button || !videoInput) {
            console.error("EweVoice: bouton ou videoInput introuvable.");
            return;
        }

        // Force le bouton actif
        button.disabled = false;
        button.removeAttribute("disabled");
        button.style.pointerEvents = "auto";
        button.style.position = "relative";
        button.style.zIndex = "99999";
        button.style.cursor = "pointer";

        // Évite les doubles installations
        if (button.dataset.extractionFixInstalled === "yes") return;
        button.dataset.extractionFixInstalled = "yes";

        async function extractVideo(event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            if (!videoInput.files || !videoInput.files[0]) {
                alert("Veuillez d'abord choisir une vidéo.");
                return;
            }

            const videoFile = videoInput.files[0];
            const language =
                sourceLanguage?.value ||
                document.getElementById("languageSelect")?.value ||
                "eng_Latn";

            button.disabled = true;
            button.textContent = "⏳ Extraction en cours...";

            // Création de la zone de résultats
            let resultBox = document.getElementById("extractionResults");

            if (!resultBox) {
                resultBox = document.createElement("div");
                resultBox.id = "extractionResults";
                resultBox.style.marginTop = "20px";
                button.parentElement.appendChild(resultBox);
            }

            resultBox.innerHTML = `
                <div style="padding:18px;border-radius:12px;background:#f5f7fa;">
                    <h3>Extraction</h3>

                    <div style="margin-bottom:15px;">
                        <strong>🎧 Extraction audio</strong>
                        <div style="height:12px;background:#ddd;border-radius:10px;margin-top:7px;overflow:hidden;">
                            <div id="audioProgress"
                                 style="height:100%;width:0%;background:#2196f3;transition:width .3s;"></div>
                        </div>
                        <div id="audioStatus">Préparation de l'audio...</div>
                    </div>

                    <div style="margin-bottom:15px;">
                        <strong>📝 Extraction du texte</strong>
                        <div style="height:12px;background:#ddd;border-radius:10px;margin-top:7px;overflow:hidden;">
                            <div id="textProgress"
                                 style="height:100%;width:0%;background:#4caf50;transition:width .3s;"></div>
                        </div>
                        <div id="textStatus">En attente...</div>
                    </div>

                    <div id="audioResult"></div>

                    <h3>📝 Texte extrait</h3>
                    <div id="liveSubtitles"
                         style="max-height:400px;overflow:auto;background:white;padding:10px;border-radius:8px;">
                    </div>
                </div>
            `;

            const audioProgress = document.getElementById("audioProgress");
            const textProgress = document.getElementById("textProgress");
            const audioStatus = document.getElementById("audioStatus");
            const textStatus = document.getElementById("textStatus");
            const audioResult = document.getElementById("audioResult");
            const liveSubtitles = document.getElementById("liveSubtitles");

            try {
                const formData = new FormData();
                formData.append("video", videoFile);
                formData.append("sourceLanguage", language);

                audioStatus.textContent = "Extraction audio démarrée...";
                audioProgress.style.width = "10%";

                const response = await fetch("/api/transcribe", {
                    method: "POST",
                    body: formData
                });

                if (!response.ok) {
                    throw new Error("Le serveur a refusé l'extraction.");
                }

                const data = await response.json();

                if (!data.success || !data.jobId) {
                    throw new Error(data.error || "Job d'extraction introuvable.");
                }

                const jobId = data.jobId;

                textStatus.textContent = "Transcription démarrée...";
                textProgress.style.width = "30%";

                let audioDisplayed = false;
                let lastSegmentCount = 0;

                const poll = async () => {
                    const statusResponse =
                        await fetch("/api/transcribe/" + encodeURIComponent(jobId));

                    if (!statusResponse.ok) {
                        throw new Error("Impossible de lire la progression.");
                    }

                    const job = await statusResponse.json();

                    // Audio disponible dès qu'il est extrait
                    if (job.audioUrl && !audioDisplayed) {
                        audioDisplayed = true;

                        audioProgress.style.width = "25%";
                        audioStatus.textContent = "Audio extrait avec succès.";

                        audioResult.innerHTML = `
                            <div style="margin:15px 0;padding:15px;background:#e8f5e9;border-radius:10px;">
                                <strong>🎧 Audio extrait</strong>
                                <audio controls preload="metadata"
                                       style="width:100%;margin-top:10px;"
                                       src="${job.audioUrl}">
                                </audio>
                            </div>
                        `;
                    }

                    // Progression réelle de la transcription
                    if (typeof job.progress === "number") {
                        const p = Math.max(0, Math.min(100, job.progress));

                        if (job.stage === "transcription") {
                            textProgress.style.width = p + "%";
                            textStatus.textContent =
                                "Transcription en cours : " + p + "%";
                        }

                        if (job.stage === "complete") {
                            textProgress.style.width = "100%";
                            textStatus.textContent = "Texte extrait à 100%.";
                        }
                    }

                    // Affichage progressif des segments
                    if (Array.isArray(job.subtitles)) {
                        if (job.subtitles.length > lastSegmentCount) {
                            liveSubtitles.innerHTML = job.subtitles.map((seg, i) => {
                                const start =
                                    Number(seg.start || 0).toFixed(2);
                                const end =
                                    Number(seg.end || 0).toFixed(2);

                                return `
                                    <div style="
                                        padding:10px;
                                        margin-bottom:8px;
                                        border-bottom:1px solid #ddd;
                                    ">
                                        <small>
                                            ${start}s → ${end}s
                                        </small>
                                        <div style="margin-top:4px;font-size:16px;">
                                            ${escapeHtml(seg.text || "")}
                                        </div>
                                    </div>
                                `;
                            }).join("");

                            lastSegmentCount = job.subtitles.length;

                            liveSubtitles.scrollTop =
                                liveSubtitles.scrollHeight;
                        }
                    }

                    if (job.done) {
                        audioProgress.style.width = "100%";
                        textProgress.style.width = "100%";

                        audioStatus.textContent =
                            "Audio extrait et disponible.";
                        textStatus.textContent =
                            "Extraction du texte terminée.";

                        button.disabled = false;
                        button.textContent = "📝 Extraire les sous-titres";

                        return;
                    }

                    if (job.error) {
                        throw new Error(job.error);
                    }

                    setTimeout(poll, 800);
                };

                await poll();

            } catch (error) {
                console.error("EweVoice extraction:", error);

                audioStatus.textContent = "Erreur d'extraction.";
                textStatus.textContent = error.message;

                button.disabled = false;
                button.textContent = "📝 Extraire les sous-titres";

                alert("Erreur pendant l'extraction : " + error.message);
            }
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        // Capture avant les anciens gestionnaires :
        // cela garantit que le bouton fonctionne même si un ancien
        // gestionnaire dans app.js bloque le clic.
        button.addEventListener("click", extractVideo, true);

        console.log("EweVoice : bouton Extraction opérationnel.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initExtractionFix);
    } else {
        initExtractionFix();
    }
})();


/* =========================================================
   APPLICATION AUDIO EWE -> VIDEO FINALE
========================================================= */

(function () {

    const button = document.getElementById("applyEweVideoButton");
    const progressBox = document.getElementById("applyEweVideoProgressBox");
    const progressBar = document.getElementById("applyEweVideoProgressBar");
    const progressText = document.getElementById("applyEweVideoProgressText");
    const percentText = document.getElementById("applyEweVideoPercent");
    const status = document.getElementById("applyEweVideoStatus");
    const finalBox = document.getElementById("finalEweVideoBox");
    const finalVideo = document.getElementById("finalEweVideo");
    const downloadLink = document.getElementById("downloadFinalEweVideo");

    if (!button) return;

    button.addEventListener("click", async function () {

        const transcriptionJobId =
            window.transcriptionJobId ||
            window.currentTranscriptionJobId ||
            null;

        const audioJobId =
            window.eweAudioJobId ||
            window.currentEweAudioJobId ||
            null;

        if (!transcriptionJobId) {
            status.textContent =
                "❌ La transcription originale est introuvable.";
            return;
        }

        if (!audioJobId) {
            status.textContent =
                "❌ L'audio Éwé synchronisé est introuvable. Terminez d'abord la traduction audio.";
            return;
        }

        button.disabled = true;
        progressBox.style.display = "block";
        finalBox.style.display = "none";

        progressBar.style.width = "10%";
        percentText.textContent = "10 %";
        progressText.textContent = "Préparation de la vidéo...";
        status.textContent = "";

        try {

            const response = await fetch("/api/apply-ewe-audio", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    transcriptionJobId: transcriptionJobId,
                    audioJobId: audioJobId
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.error ||
                    "Impossible de créer la vidéo finale."
                );
            }

            const jobId = data.jobId;

            async function checkStatus() {

                const result =
                    await fetch(
                        "/api/apply-ewe-audio/" +
                        encodeURIComponent(jobId)
                    );

                const job = await result.json();

                if (!job.success) {
                    throw new Error(
                        job.error ||
                        "Erreur pendant la création de la vidéo."
                    );
                }

                const progress =
                    Number(job.progress || 0);

                progressBar.style.width =
                    progress + "%";

                percentText.textContent =
                    progress + " %";

                if (job.stage === "applying_ewe_audio") {
                    progressText.textContent =
                        "Application de l'audio Éwé à la vidéo...";
                }
                else if (job.stage === "complete") {
                    progressText.textContent =
                        "Vidéo finale terminée.";
                }
                else {
                    progressText.textContent =
                        "Préparation...";
                }

                if (
                    job.status === "complete" &&
                    job.videoUrl
                ) {

                    progressBar.style.width = "100%";
                    percentText.textContent = "100 %";
                    progressText.textContent =
                        "Vidéo finale terminée.";

                    finalVideo.src =
                        job.videoUrl +
                        "?t=" +
                        Date.now();

                    downloadLink.href =
                        job.videoUrl;

                    finalBox.style.display = "block";

                    status.textContent =
                        "✅ La vidéo finale en Éwé est prête.";

                    button.disabled = false;
                    return;
                }

                if (job.status === "error") {
                    throw new Error(
                        job.error ||
                        "La création de la vidéo finale a échoué."
                    );
                }

                setTimeout(checkStatus, 1000);
            }

            checkStatus();

        } catch (error) {

            console.error(
                "APPLICATION AUDIO EWE -> VIDEO:",
                error
            );

            status.textContent =
                "❌ " +
                (error.message ||
                "Erreur inconnue.");

            button.disabled = false;
        }
    });

})();

