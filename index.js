import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = 5000;

//middleware
app.use(express.json());

app.use(cors());

app.get('/', (req, res) => {
  res.send('wedplan server!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});