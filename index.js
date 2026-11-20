import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
const port = 5000;

//middleware
app.use(express.json());


const client = new MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.othdrf.mongodb.net/`);

app.use(cors());


export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectClint= await connectToMongoDB();

const database = connectClint.db("wedplandb");
const users = database.collection("user");

app.get('/', (req, res) => {
  res.send('wedplan server!');
});

app.get('/users', async (req, res) => {
  const cursor = await users.find({});
  const result = await cursor.toArray();
  res.send(result);


})



app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});