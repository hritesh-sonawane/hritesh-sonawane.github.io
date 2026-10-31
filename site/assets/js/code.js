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
        // textContent, not innerText: the line spans are flex boxes, so innerText adds a blank line after each.
        await navigator.clipboard.writeText(code.textContent.replace(/\n$/, ""));
        report("Copied", "ok");
      } catch {
        report("Copy failed", "error");
      }
    });
  });
})();
