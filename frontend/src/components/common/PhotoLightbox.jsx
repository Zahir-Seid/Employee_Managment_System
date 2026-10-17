import { useEffect } from "react";

// Item 23: photos on the Event Status Report view used to open via a plain
// <a target="_blank">, which left the app entirely to show the raw image
// file on its own browser tab, no way back except closing that tab. This
// renders the photo in an in-app overlay instead, with a visible "Back"
// button (plus Esc / click-outside / arrow keys when there's more than
// one photo), so viewing a photo never actually navigates away.
export default function PhotoLightbox({ photos, index, onClose, onNavigate }) {
  const photo = photos[index];

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < photos.length - 1) onNavigate(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, photos.length, onClose, onNavigate]);

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-navy-900/90 px-4 py-4"
      onClick={onClose}
    >
      <div className="flex items-center justify-between shrink-0 mb-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="jm-back-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
          Back
        </button>
        {photos.length > 1 && (
          <span className="text-sm text-white/70">
            {index + 1} of {photos.length}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center gap-4">
        {photos.length > 1 && (
          <button
            type="button"
            aria-label="Previous photo"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index - 1);
            }}
            className="shrink-0 text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <img
          src={photo.image}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain rounded-md"
        />

        {photos.length > 1 && (
          <button
            type="button"
            aria-label="Next photo"
            disabled={index === photos.length - 1}
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index + 1);
            }}
            className="shrink-0 text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
