// public/js/include-nav.js
(async () => {
    const resp = await fetch("/nav.html");
    const html = await resp.text();
    document.getElementById("nav-placeholder").innerHTML = html;
    // dispatch so auth.js knows nav is ready
    document.dispatchEvent(new Event("nav-loaded"));
})();
