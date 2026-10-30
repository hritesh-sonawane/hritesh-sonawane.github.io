(() => {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    const block = button.closest(".code-block");
    const code = block && block.querySelector("pre code");
    const status = block && block.querySelector("[data-copy-status]");
    if (!code || !navigator.clipboard) return;
    button.hidden = false;
    let timer;
    const report = (message, state) => {
      button.textContent = message;
      button.dataset.state = state;
      if (status) status.textContent = message;
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = "Copy";
        delete button.dataset.state;
        if (status) status.textContent = "";
      }, 2000);
    };
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.innerText.replace(/\n$/, ""));
        report("Copied", "ok");
      } catch {
        report("Copy failed", "error");
      }
    });
  });
})();
