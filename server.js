const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
    console.log("");
    console.log("=================================");
    console.log("       EWEVOICE DEMARRE");
    console.log("=================================");
    console.log(`Site : http://localhost:${PORT}`);
    console.log("");
});
