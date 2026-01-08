const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');

async function loadContent(tabName) {
    const contentDiv = document.getElementById(tabName + '-content');
    if (!contentDiv.innerHTML) {
        try {
            const response = await fetch(tabName + '.html');
            if (response.ok) {
                contentDiv.innerHTML = await response.text();
            } else {
                contentDiv.innerHTML = '<p>Error loading content.</p>';
            }
        } catch (error) {
            contentDiv.innerHTML = '<p>Error loading content.</p>';
        }
    }
}

// Load both work and photo content on page load
loadContent('work');
loadContent('photo');

tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        await loadContent(tabName);
        document.getElementById(tabName + '-content').classList.add('active');
    });
});