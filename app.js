const actionCards = document.querySelectorAll(".action-card");
let activeTimer;

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
