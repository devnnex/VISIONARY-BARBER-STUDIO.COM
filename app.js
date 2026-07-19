const actionCards = document.querySelectorAll(".action-card");
const backgroundVideo = document.querySelector(".background-video");
const soundToggle = document.querySelector(".sound-toggle");
const whatsappCard = document.querySelector('[data-network="whatsapp"]');
let activeTimer;

const isMobileDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const buildWhatsAppLinks = (phone, message) => {
  const encodedMessage = encodeURIComponent(message);

  return {
    app: `whatsapp://send?phone=${phone}&text=${encodedMessage}`,
    web: `https://api.whatsapp.com/send?phone=${phone}&text=${encodedMessage}`,
  };
};

actionCards.forEach((card) => {
  card.addEventListener("pointerdown", () => {
    window.clearTimeout(activeTimer);
    actionCards.forEach((item) => item.classList.remove("is-active"));
    card.classList.add("is-active");

    activeTimer = window.setTimeout(() => {
      card.classList.remove("is-active");
    }, 450);
  });
});

window.addEventListener("pageshow", () => {
  actionCards.forEach((item) => item.classList.remove("is-active"));
});

whatsappCard?.addEventListener("click", (event) => {
  const phone = whatsappCard.dataset.phone;
  const message = whatsappCard.dataset.message || "";

  if (!phone || !isMobileDevice()) return;

  event.preventDefault();

  const links = buildWhatsAppLinks(phone, message);
  const fallbackTimer = window.setTimeout(() => {
    window.location.href = links.web;
  }, 900);

  const clearFallback = () => {
    window.clearTimeout(fallbackTimer);
  };

  window.addEventListener("pagehide", clearFallback, { once: true });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) clearFallback();
    },
    { once: true }
  );

  window.location.href = links.app;
});

const updateSoundButton = () => {
  if (!backgroundVideo || !soundToggle) return;

  const isOn = !backgroundVideo.muted && backgroundVideo.volume > 0;
  soundToggle.classList.toggle("is-on", isOn);
  soundToggle.classList.toggle("needs-gesture", !isOn);
  soundToggle.setAttribute("aria-pressed", String(isOn));
  soundToggle.setAttribute("aria-label", isOn ? "Silenciar musica de fondo" : "Activar musica de fondo");
  soundToggle.title = isOn ? "Silenciar musica" : "Activar musica";
};

const playBackgroundVideo = async ({ withSound = false } = {}) => {
  if (!backgroundVideo) return;

  backgroundVideo.volume = 0.32;
  backgroundVideo.muted = !withSound;

  try {
    await backgroundVideo.play();
  } catch (error) {
    backgroundVideo.muted = true;
    updateSoundButton();

    try {
      await backgroundVideo.play();
    } catch (_) {
      // Some mobile browsers wait for the first user gesture before any media can start.
    }
  }

  updateSoundButton();
};

playBackgroundVideo({ withSound: true });

soundToggle?.addEventListener("click", async () => {
  if (!backgroundVideo) return;

  const shouldEnableSound = backgroundVideo.muted || backgroundVideo.volume === 0;
  await playBackgroundVideo({ withSound: shouldEnableSound });

  if (!shouldEnableSound) {
    backgroundVideo.muted = true;
    updateSoundButton();
  }
});

const unlockBackgroundAudio = () => {
  if (backgroundVideo?.paused || backgroundVideo?.muted) {
    playBackgroundVideo({ withSound: true });
  }
};

["pointerdown", "touchstart", "click", "keydown"].forEach((eventName) => {
  document.addEventListener(eventName, unlockBackgroundAudio, {
    once: true,
    capture: true,
    passive: true,
  });
});
