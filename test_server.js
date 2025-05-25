const express = require('express');
const app = express();
const PORT = 5050;

app.get('/', (req, res) => {
  res.send('Minimal server is working!');
});

app.listen(PORT, () => {
  console.log(`Minimal test server listening on http://localhost:${PORT}`);
}); 