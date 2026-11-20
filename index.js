import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient,ObjectId } from 'mongodb';

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

const ServiceCollection = database.collection("services");

app.get('/', (req, res) => {
  res.send('wedplan server!');
});

app.get('/users', async (req, res) => {
  const cursor = await users.find({});
  const result = await cursor.toArray();
  res.send(result);


})

// Service api
app.post("/services", async (req, res) => {
  try {
    const { name, category, location, price, description, photoUrl } = req.body

    if (!name?.trim() || !category || !location || !description?.trim() || !(Number(price) > 0)) {
      return res.status(400).send({ message: "Invalid service data" })
    }

    const service = {
      name: name.trim(),
      category,
      location,
      price: Number(price),
      description: description.trim(),
      photoUrl: photoUrl || null,
      status: "pending", // matches "Your service starts as Pending"
      createdAt: new Date(),
    }

    const result = await ServiceCollection.insertOne(service)
    res.status(201).send(result)
  } catch (error) {
    console.error(error)
    res.status(500).send({ message: "Failed to create service" })
  }
})

app.get('/services', async (req, res) => {
  const cursor = await ServiceCollection.find({});
  const result = await cursor.toArray();
  res.send(result);
});


app.delete('/services/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await ServiceCollection.deleteOne(query);
  res.send(result);
});

app.patch('/services/:id', async (req, res) => {
  const id = req.params.id;
  const updatedService = req.body;
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: updatedService,
  };
  const result = await ServiceCollection.updateOne(filter, updateDoc);
  res.send(result);
});


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});