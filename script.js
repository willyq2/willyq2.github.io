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

loadContent('work');

tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
        const tabName = tab.dataset.tab;
       
        await loadContent(tabName);

        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(tabName + '-content').classList.add('active');
    });
});
