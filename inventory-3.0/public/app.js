init().catch((error) => {
  app.innerHTML = `<main class="login-screen"><section class="login-card"><h1>Inventory 3.0 could not start</h1><p class="subtitle">${esc(error.message)}</p></section></main>`;
});
