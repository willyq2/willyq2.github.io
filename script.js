const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');

async function loadContent(tabName) {
    const contentDiv = document.getElementById(`${tabName}-content`);
    if (contentDiv.innerHTML) return; // already loaded, don't re-fetch

    try {
        const response = await fetch(`${tabName}.html`);
        contentDiv.innerHTML = response.ok
            ? await response.text()
            : '<p>Error loading content.</p>';
    } catch {
        contentDiv.innerHTML = '<p>Error loading content.</p>';
    }
}

function showTab(tabName) {
    tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
    contents.forEach(content => content.classList.toggle('active', content.id === `${tabName}-content`));
    loadContent(tabName);
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
});

showTab('data');