const oldRecordingSection = document.getElementById("recordingSection");
const oldRecordingList = document.getElementById("recordingList");

let activeRecorder = null;
let activeRecorderIndex = null;
let activeRecorderChunks = [];

recordings = [];


/* =========================================================
   AFFICHAGE DES SEGMENTS À ENREGISTRER
========================================================= */

function afficherEnregistrements() {

    if (!oldRecordingList) return;

    oldRecordingList.innerHTML = "";

    if (!translatedSubtitles.length) {
        oldRecordingList.innerHTML =
            "<p>Aucun texte Éwé disponible.</p>";
        return;
    }

    translatedSubtitles.forEach((subtitle, index) => {

        const row =
            document.createElement("div");

        row.className = "recording-row";

        row.innerHTML = `
            <div class="recording-header">
                <strong>Segment ${index + 1}</strong>

                <span>
                    ${escapeHTML(subtitle.start)}
                    →
                    ${escapeHTML(subtitle.end)}
                </span>
            </div>

            <div
                class="hebrew-text ewe-text"
                dir="auto"
            >
                ${escapeHTML(subtitle.text)}
            </div>

            <div class="recording-controls">

                <button
                    type="button"
                    class="record-button"
                    data-index="${index}"
                >
                    🎙️ Démarrer l'enregistrement
                </button>

                <button
                    type="button"
                    class="stop-record-button"
                    data-index="${index}"
                    disabled
                >
                    ⏹️ Arrêter
                </button>

            </div>

            <div
                class="recording-status"
                id="recording-status-${index}"
            >
                Aucun enregistrement
            </div>

            <audio
                id="recording-audio-${index}"
                controls
                style="display:none;width:100%;margin-top:10px;"
            ></audio>
        `;

        oldRecordingList.appendChild(row);
    });
}


/* =========================================================
   DÉMARRER / ARRÊTER
========================================================= */

oldRecordingList?.addEventListener(
    "click",
    async event => {

        const startButton =
            event.target.closest(
                ".record-button"
            );

        const stopButton =
            event.target.closest(
                ".stop-record-button"
            );


        if (startButton) {

            const index =
                Number(
                    startButton.dataset.index
                );

            await startRecording(index);

            return;
        }


        if (stopButton) {

            const index =
                Number(
                    stopButton.dataset.index
                );

            stopRecording(index);
        }
    }
);


/* =========================================================
   DÉMARRER ENREGISTREMENT
========================================================= */

async function startRecording(index) {

    try {

        if (
            activeRecorder &&
            activeRecorder.state !== "inactive"
        ) {

            activeRecorder.stop();
        }


        const stream =
            await navigator.mediaDevices.getUserMedia({
                audio: true
            });


        activeRecorderChunks = [];

        activeRecorderIndex =
            index;


        let options = {};


        if (
            MediaRecorder.isTypeSupported(
                "audio/webm;codecs=opus"
            )
        ) {

            options.mimeType =
                "audio/webm;codecs=opus";

        } else if (
            MediaRecorder.isTypeSupported(
                "audio/webm"
            )
        ) {

            options.mimeType =
                "audio/webm";
        }


        activeRecorder =
            new MediaRecorder(
                stream,
                options
            );


        activeRecorder.ondataavailable =
            event => {

                if (
                    event.data &&
                    event.data.size > 0
                ) {

                    activeRecorderChunks.push(
                        event.data
                    );
                }
            };


        activeRecorder.onstop =
            async () => {

                stream
                    .getTracks()
                    .forEach(
                        track =>
                            track.stop()
                    );


                const mimeType =
                    activeRecorder.mimeType ||
                    "audio/webm";


                const blob =
                    new Blob(
                        activeRecorderChunks,
                        {
                            type: mimeType
                        }
                    );


                recordings[index] = {

                    blob,

                    mimeType,

                    index,

                    start:
                        translatedSubtitles[index]
                            .start,

                    end:
                        translatedSubtitles[index]
                            .end,

                    text:
                        translatedSubtitles[index]
                            .text
                };


                const audio =
                    document.getElementById(
                        `recording-audio-${index}`
                    );


                if (audio) {

                    if (audio.src) {
                        URL.revokeObjectURL(
                            audio.src
                        );
                    }

                    audio.src =
                        URL.createObjectURL(
                            blob
                        );

                    audio.style.display =
                        "block";
                }


                updateRecordingUI(
                    index,
                    "✅ Enregistrement terminé. Vous pouvez l'écouter."
                );


                updateRecordingButtons(
                    index,
                    false
                );


                activeRecorder = null;
                activeRecorderIndex = null;
                activeRecorderChunks = [];


                checkAllRecordings();
            };


        activeRecorder.start();


        updateRecordingUI(
            index,
            "🔴 Enregistrement en cours..."
        );


        updateRecordingButtons(
            index,
            true
        );


    } catch (error) {

        console.error(
            error
        );


        updateRecordingUI(
            index,
            "❌ Impossible d'accéder au microphone."
        );


        alert(
            "Autorisez l'accès au microphone dans votre navigateur pour enregistrer votre voix."
        );
    }
}


/* =========================================================
   ARRÊTER
========================================================= */

function stopRecording(index) {

    if (
        !activeRecorder ||
        activeRecorder.state === "inactive"
    ) {
        return;
    }


    if (
        activeRecorderIndex !== index
    ) {
        return;
    }


    activeRecorder.stop();
}


/* =========================================================
   INTERFACE
========================================================= */

function updateRecordingUI(
    index,
    message
) {

    const element =
        document.getElementById(
            `recording-status-${index}`
        );


    if (element) {

        element.textContent =
            message;
    }
}


function updateRecordingButtons(
    index,
    recording
) {

    const startButton =
        oldRecordingList?.querySelector(
            `.record-button[data-index="${index}"]`
        );

    const stopButton =
        oldRecordingList?.querySelector(
            `.stop-record-button[data-index="${index}"]`
        );


    if (startButton) {

        startButton.disabled =
            recording;

        startButton.textContent =
            recording
                ? "🔴 Enregistrement..."
                : recordings[index]
                    ? "🔄 Réenregistrer"
                    : "🎙️ Démarrer l'enregistrement";
    }


    if (stopButton) {

        stopButton.disabled =
            !recording;
    }
}


/* =========================================================
   VÉRIFIER TOUS LES ENREGISTREMENTS
========================================================= */

function checkAllRecordings() {

    if (!translatedSubtitles.length) {
        return;
    }


    const completed =
        translatedSubtitles.every(
            (_, index) =>
                recordings[index] &&
                recordings[index].blob
        );


    if (completed) {

        voiceSection.style.display =
            "block";

        renderSection.style.display =
            "block";


        previewVoiceButton.disabled =
            false;


        renderButton.disabled =
            false;


        renderSection.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}


/* =========================================================
   APERÇU DE LA VOIX TRANSFORMÉE
========================================================= */

previewVoiceButton?.addEventListener(
    "click",
    async () => {

        const firstRecording =
            recordings.find(
                item =>
                    item &&
                    item.blob
            );


        if (!firstRecording) {

            alert(
                "Enregistrez d'abord au moins un segment."
            );

            return;
        }


        previewVoiceButton.disabled =
            true;


        previewVoiceButton.textContent =
            "⏳ Transformation...";


        try {

            const formData =
                new FormData();


            formData.append(
                "audio",
                firstRecording.blob,
                "voice-preview.webm"
            );


            formData.append(
                "preset",
                voicePreset.value
            );


            const response =
                await fetch(
                    "/api/transform-voice",
                    {
                        method: "POST",
                        body: formData
                    }
                );


            const data =
                await response.json();


            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.error ||
                    "Transformation impossible."
                );
            }


            voicePreview.src =
                data.audio;


            voicePreview.style.display =
                "block";


            await voicePreview.play();


        } catch (error) {

            console.error(
                error
            );


            alert(
                error.message
            );


        } finally {

            previewVoiceButton.disabled =
                false;

            previewVoiceButton.textContent =
                "🔊 Écouter la transformation";
        }
    }
);


/* =========================================================
   INITIALISATION
========================================================= */

const originalAfficherEnregistrements =
    afficherEnregistrements;


/*
 * On réaffiche les contrôles après
 * l'arrivée de la traduction Éwé.
 */

const oldTranslateButton =
    translateButton;


oldTranslateButton?.addEventListener(
    "click",
    () => {

        setTimeout(
            () => {

                afficherEnregistrements();

                recordingSection.style.display =
                    "block";

            },
            500
        );
    }
);
