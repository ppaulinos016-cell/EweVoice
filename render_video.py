import sys
import os
import subprocess

FFMPEG = r"C:\Users\hp\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"

def main():
    if len(sys.argv) < 4:
        print("Usage: python render_video.py video.mp4 audio.wav sortie.mp4")
        sys.exit(1)

    video = os.path.abspath(sys.argv[1])
    audio = os.path.abspath(sys.argv[2])
    output = os.path.abspath(sys.argv[3])

    if not os.path.exists(video):
        raise FileNotFoundError(f"Vidéo introuvable : {video}")

    if not os.path.exists(audio):
        raise FileNotFoundError(f"Audio Éwé introuvable : {audio}")

    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    cmd = [
        FFMPEG,
        "-y",
        "-i", video,
        "-i", audio,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output
    ]

    print("=================================")
    print("RENDU VIDEO EWEVOICE")
    print("=================================")

    result = subprocess.run(cmd)

    if result.returncode != 0:
        raise RuntimeError("FFmpeg a échoué pendant le rendu vidéo.")

    print("")
    print("=================================")
    print("VIDEO EWE TERMINEE")
    print("=================================")
    print(f"Fichier : {output}")

if __name__ == "__main__":
    main()
