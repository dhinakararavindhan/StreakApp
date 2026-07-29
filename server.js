const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3000;

const app = createApp();
app.listen(PORT, () => {
  console.log(`CMS running at http://localhost:${PORT}`);
  console.log(`Admin panel:   http://localhost:${PORT}/admin`);
});
