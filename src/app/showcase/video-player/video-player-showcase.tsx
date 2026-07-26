"use client";

import { FileVideo2, RotateCcw, UploadCloud } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AcademyVideoPlayer } from "@/components/media/academy-video-player";

export type ShowcaseState =
  | "initial"
  | "playing"
  | "paused"
  | "loading"
  | "error"
  | "completed";

const STATE_LABELS: Array<{ id: ShowcaseState; label: string }> = [
  { id: "initial", label: "Начало" },
  { id: "playing", label: "Воспроизведение" },
  { id: "paused", label: "Пауза" },
  { id: "loading", label: "Загрузка" },
  { id: "error", label: "Ошибка" },
  { id: "completed", label: "Завершено" },
];

const DEMO_SOURCE = "/showcase/video-player/academy-lesson-demo.webm";

// Containers a browser can plausibly open. The <video> element's error handler
// is the final arbiter for codecs the browser cannot actually decode.
const SUPPORTED_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "m4v", "mov", "mkv"]);

interface LocalVideo {
  name: string;
  size: number;
  type: string;
  extension: string;
  url: string;
}

function getExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// A user-picked file rarely arrives as a clean "video/mp4": Windows commonly
// reports "application/octet-stream", phones hand over "video/quicktime" (.mov),
// and .m4v/.mkv carry non-standard MIME types. Accept anything the browser
// labels as video/*, or a known video container by extension; only reject files
// that are clearly not video. Decoding failures are surfaced separately by the
// player's error handler.
function isSupportedVideo(file: File) {
  const type = file.type.toLowerCase();
  return (
    type.startsWith("video/") ||
    SUPPORTED_VIDEO_EXTENSIONS.has(getExtension(file.name))
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function setFixtureMediaValues(video: HTMLVideoElement, state: ShowcaseState) {
  try {
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 584,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: state === "completed" ? 584 : state === "initial" ? 0 : 126,
    });
  } catch {
    // Real media metadata remains authoritative when browser properties are sealed.
  }
}

export function VideoPlayerShowcase({
  initialState,
}: {
  initialState: ShowcaseState;
}) {
  const [state, setState] = useState(initialState);
  const [localVideo, setLocalVideo] = useState<LocalVideo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const stopCurrentVideo = useCallback(() => {
    const video = previewRef.current?.querySelector("video");
    if (!video) return;

    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // A source without metadata can reject seeking; remounting still resets it.
    }
  }, []);

  const selectLocalVideo = useCallback(
    (file: File | undefined) => {
      if (!file) return;

      if (!isSupportedVideo(file)) {
        setFileError(
          "Не похоже на видео. Поддерживаются MP4, WebM, MOV, M4V и MKV.",
        );
        return;
      }

      stopCurrentVideo();
      const nextUrl = URL.createObjectURL(file);
      const previousUrl = objectUrlRef.current;
      objectUrlRef.current = nextUrl;
      setLocalVideo({
        name: file.name,
        size: file.size,
        type: file.type,
        extension: getExtension(file.name),
        url: nextUrl,
      });
      setFileError(null);
      setMediaError(null);
      setState("initial");

      if (previousUrl) URL.revokeObjectURL(previousUrl);
    },
    [stopCurrentVideo],
  );

  const resetLocalVideo = useCallback(() => {
    stopCurrentVideo();
    const previousUrl = objectUrlRef.current;
    objectUrlRef.current = null;
    setLocalVideo(null);
    setFileError(null);
    setMediaError(null);
    setState("initial");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }, [stopCurrentVideo]);

  // A local file passes container validation but may still use a codec the
  // browser cannot decode (e.g. HEVC in a .mov). The player accepts the source,
  // fails to decode, and reports it here so we can explain the real reason
  // instead of the demo's generic "check your connection" copy.
  const handlePlayerError = useCallback(
    (error: MediaError | null) => {
      if (!localVideo) return;
      setMediaError(error?.code ?? 0);
    },
    [localVideo],
  );

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectLocalVideo(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    selectLocalVideo(event.dataTransfer.files?.[0]);
  };

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (localVideo) return;

    const video = previewRef.current?.querySelector("video");
    if (!video) return;

    const timer = window.setTimeout(() => {
      setFixtureMediaValues(video, state);
      video.dispatchEvent(new Event("loadedmetadata"));

      if (state === "initial") return;

      if (state === "error") {
        video.dispatchEvent(new Event("error"));
        return;
      }

      video.dispatchEvent(new Event("play"));
      video.dispatchEvent(new Event("timeupdate"));

      if (state === "loading") video.dispatchEvent(new Event("waiting"));
      if (state === "paused") video.dispatchEvent(new Event("pause"));
      if (state === "completed") video.dispatchEvent(new Event("ended"));
    }, 80);

    return () => window.clearTimeout(timer);
  }, [localVideo, state]);

  const playerSource = localVideo?.url ?? DEMO_SOURCE;

  return (
    <main className="vps">
      <header className="vps__header">
        <div className="vps__brand" aria-label="Alfa Trade Academy">
          <span className="vps__brand-mark" aria-hidden="true">
            A
          </span>
          <span>Alfa Trade Academy</span>
        </div>
        <span className="vps__meta">Component showcase / Media</span>
      </header>

      <section className="vps__stage" aria-labelledby="showcase-title">
        <div className="vps__intro">
          <p>Учебная среда</p>
          <h1 id="showcase-title">Видео для урока. Без лишнего шума.</h1>
          <span>
            Самостоятельный HTML5-плеер для уроков Academy. Состояния ниже
            принадлежат только showcase.
          </span>
        </div>

        <div className="vps__toolbar" aria-label="Состояние плеера">
          {STATE_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={state === item.id}
              onClick={() => setState(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="vps__local-video" aria-labelledby="local-video-title">
          <div className="vps__local-video-copy">
            <span>Локальный источник</span>
            <strong id="local-video-title">
              {localVideo?.name ?? "Демонстрационный урок Academy"}
            </strong>
            <p>
              MP4, WebM, MOV, M4V или MKV — файл остаётся на вашем устройстве
            </p>
          </div>

          <div
            className="vps__dropzone"
            data-drag-active={dragActive || undefined}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              className="vps__file-input"
              type="file"
              accept="video/*,.mp4,.webm,.m4v,.mov,.mkv"
              aria-label="Выбрать локальное видео"
              onChange={handleFileChange}
            />
            {localVideo ? (
              <FileVideo2 aria-hidden="true" />
            ) : (
              <UploadCloud aria-hidden="true" />
            )}
            <span>{dragActive ? "Отпустите файл" : "Перетащите видео сюда"}</span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              {localVideo ? "Выбрать другое" : "Выбрать видео"}
            </button>
          </div>

          <div className="vps__local-video-actions">
            {fileError && (
              <p className="vps__file-error" role="alert">
                {fileError}
              </p>
            )}
            {mediaError != null && (
              <p className="vps__file-error" role="alert">
                Файл выбран, но браузер не поддерживает его видеокодек.
                Попробуйте MP4 (H.264) или WebM.
              </p>
            )}
            {localVideo && (
              <button
                type="button"
                className="vps__reset-source"
                onClick={resetLocalVideo}
              >
                <RotateCcw aria-hidden="true" />
                Сбросить
              </button>
            )}
          </div>

          {localVideo && (
            <dl className="vps__diagnostics" aria-label="Диагностика файла">
              <div>
                <dt>Имя</dt>
                <dd>{localVideo.name}</dd>
              </div>
              <div>
                <dt>Размер</dt>
                <dd>{formatBytes(localVideo.size)}</dd>
              </div>
              <div>
                <dt>MIME</dt>
                <dd>{localVideo.type || "— (не указан)"}</dd>
              </div>
              <div>
                <dt>Расширение</dt>
                <dd>{localVideo.extension ? `.${localVideo.extension}` : "—"}</dd>
              </div>
              <div>
                <dt>Статус</dt>
                <dd>
                  {mediaError != null
                    ? `ошибка декодирования (код ${mediaError})`
                    : "источник назначен"}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <div ref={previewRef} className="vps__preview">
          <AcademyVideoPlayer
            key={`${state}-${playerSource}`}
            src={playerSource}
            onError={handlePlayerError}
            title={localVideo?.name ?? "Поддержка и сопротивление"}
            description={
              localVideo
                ? "Локальное видео для ручной проверки плеера."
                : "Как находить ключевые области на графике и не принимать шум за сигнал."
            }
            captions={
              localVideo
                ? undefined
                : [
                    {
                      src: "/showcase/video-player/academy-demo-ru.vtt",
                      srcLang: "ru",
                      label: "Русский",
                    },
                  ]
            }
          />
        </div>

        <footer className="vps__footer">
          <div>
            <span>Текущий материал</span>
            <strong>Уровень 18 · Чтение графика</strong>
          </div>
          <div>
            <span>Управление</span>
            <strong>Space / ← → / M / F</strong>
          </div>
          <div>
            <span>Состояние</span>
            <strong>{STATE_LABELS.find((item) => item.id === state)?.label}</strong>
          </div>
        </footer>
      </section>
    </main>
  );
}
