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

const allowedOrigins = (
  process.env.CLIENT_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow tools/curl without an Origin header.
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);




app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
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

const BookingCollection = database.collection("bookings");
app.get('/', (req, res) => {
  res.send('wedplan server!');
});

app.get('/users', async (req, res) => {
  const cursor = await users.find({});
  const result = await cursor.toArray();
  res.send(result);


})




// Create booking
app.post("/bookings", async (req, res) => {
    try {
        const {
            serviceId,
            customerEmail,
            eventDate,
            eventLocation,
            message,
        } = req.body;

        // Validate required fields
        if (
            !serviceId ||
            !ObjectId.isValid(serviceId) ||
            !customerEmail?.trim() ||
            !eventDate ||
            !eventLocation?.trim()
        ) {
            return res.status(400).send({
                success: false,
                message: "Please provide all required booking information.",
            });
        }

        // Find service
        const service = await ServiceCollection.findOne({
            _id: new ObjectId(serviceId),
        });

        if (!service) {
            return res.status(404).send({
                success: false,
                message: "Service not found.",
            });
        }

        if (service.available === false || service.isActive === false) {
            return res.status(400).send({
                success: false,
                message: "This service is currently unavailable.",
            });
        }

        // Find customer
        const normalizedEmail = customerEmail.trim().toLowerCase();

        const customer = await users.findOne({
            email: normalizedEmail,
        });

        if (!customer) {
            return res.status(404).send({
                success: false,
                message: "Customer account not found.",
            });
        }

        // Create booking document
        const booking = {
            serviceId: new ObjectId(serviceId),

            serviceName: service.name || service.serviceName,

            customerEmail: normalizedEmail,

            customerName:
                customer.name ||
                customer.displayName ||
                "Customer",

            vendorEmail: service.vendorEmail,

            eventDate: new Date(eventDate),

            eventLocation: eventLocation.trim(),

            message: message?.trim() || "",

            price: Number(service.price) || 0,

            status: "pending",

            createdAt: new Date(),
        };

        // Save to MongoDB
        const result = await BookingCollection.insertOne(booking);

        res.status(201).send({
            success: true,
            message: "Booking request submitted successfully.",
            booking: {
                _id: result.insertedId,
                ...booking,
            },
        });

    } catch (error) {
        console.error("Booking creation error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to submit booking request.",
        });
    }
});


// Cancel a customer's pending booking
app.patch("/bookings/:id/cancel", async (req, res) => {
    try {
        const { id } = req.params;
        const { customerEmail } = req.body ?? {};

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid booking id.",
            });
        }

        if (!customerEmail?.trim()) {
            return res.status(400).send({
                success: false,
                message: "Customer email is required.",
            });
        }

        const normalizedEmail = customerEmail.trim().toLowerCase();
        const bookingId = new ObjectId(id);

        const booking = await BookingCollection.findOne({
            _id: bookingId,
        });

        if (!booking) {
            return res.status(404).send({
                success: false,
                message: "Booking not found.",
            });
        }

        // A customer may only cancel their own request.
        if (booking.customerEmail !== normalizedEmail) {
            return res.status(403).send({
                success: false,
                message: "You can only cancel your own bookings.",
            });
        }

        if (String(booking.status).toLowerCase() !== "pending") {
            return res.status(400).send({
                success: false,
                message: "Only pending booking requests can be cancelled.",
            });
        }

        const result = await BookingCollection.updateOne(
            {
                _id: bookingId,
                customerEmail: normalizedEmail,
                status: booking.status,
            },
            {
                $set: {
                    status: "cancelled",
                    cancelledAt: new Date(),
                },
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(409).send({
                success: false,
                message: "This booking changed before it could be cancelled. Please refresh and try again.",
            });
        }

        res.status(200).send({
            success: true,
            message: "Booking cancelled successfully.",
        });
    } catch (error) {
        console.error("Cancel booking error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to cancel booking.",
        });
    }
});


// Get vendor booking requests
app.get("/bookings/vendor", async (req, res) => {
    try {
        const email = req.query.email;

        if (!email || typeof email !== "string") {
            return res.status(400).send({
                success: false,
                message: "Vendor email is required.",
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const result = await BookingCollection
            .find({
                vendorEmail: normalizedEmail,
            })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).send({
            success: true,
            bookings: result,
        });

    } catch (error) {
        console.error("Fetch vendor bookings error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to fetch booking requests.",
        });
    }
});


// Accept or reject a pending booking as the vendor
app.patch("/bookings/:id/decision", async (req, res) => {
    try {
        const { id } = req.params;
        const { vendorEmail, decision } = req.body ?? {};

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid booking id.",
            });
        }

        if (!vendorEmail?.trim()) {
            return res.status(400).send({
                success: false,
                message: "Vendor email is required.",
            });
        }

        const normalizedDecision = String(decision).trim().toLowerCase();

        if (!["accepted", "rejected"].includes(normalizedDecision)) {
            return res.status(400).send({
                success: false,
                message: "Decision must be either accepted or rejected.",
            });
        }

        const normalizedEmail = vendorEmail.trim().toLowerCase();
        const bookingId = new ObjectId(id);

        const booking = await BookingCollection.findOne({
            _id: bookingId,
        });

        if (!booking) {
            return res.status(404).send({
                success: false,
                message: "Booking not found.",
            });
        }

        // A vendor may only decide on requests addressed to them.
        if (booking.vendorEmail !== normalizedEmail) {
            return res.status(403).send({
                success: false,
                message: "This booking request is not addressed to your business.",
            });
        }

        if (String(booking.status).toLowerCase() !== "pending") {
            return res.status(400).send({
                success: false,
                message: "Only pending booking requests can be updated.",
            });
        }

        const result = await BookingCollection.updateOne(
            {
                _id: bookingId,
                vendorEmail: normalizedEmail,
                status: booking.status,
            },
            {
                $set: {
                    status: normalizedDecision,
                    decidedAt: new Date(),
                },
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(409).send({
                success: false,
                message: "This request changed before your decision was saved. Please refresh and try again.",
            });
        }

        res.status(200).send({
            success: true,
            message: `Booking ${normalizedDecision} successfully.`,
        });

    } catch (error) {
        console.error("Update booking decision error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to update booking request.",
        });
    }
});


// Get customer bookings
app.get("/bookings", async (req, res) => {
    try {
        const email = req.query.email;

        if (!email || typeof email !== "string") {
            return res.status(400).send({
                success: false,
                message: "Customer email is required.",
            });
        }

        const result = await BookingCollection
            .find({
                customerEmail: email.trim().toLowerCase(),
            })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).send({
            success: true,
            bookings: result,
        });

    } catch (error) {
        console.error("Fetch bookings error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to fetch bookings.",
        });
    }
});



// Service api

app.post("/services", async (req, res) => {
    try {
        const {
            name,
            category,
            location,
            price,
            description,
            photoUrl,
            vendorEmail,
        } = req.body

        // Validate service information
        if (
            !name?.trim() ||
            !category ||
            !location ||
            !description?.trim() ||
            !(Number(price) > 0) ||
            !vendorEmail?.trim()
        ) {
            return res.status(400).send({
                success: false,
                message: "Invalid service data or vendor email",
            })
        }

        // Create service document
        const service = {
            name: name.trim(),
            category,
            location,
            price: Number(price),
            description: description.trim(),
            photoUrl: photoUrl || null,
            vendorEmail: vendorEmail.trim().toLowerCase(),
            status: "pending",
            available: true,
            createdAt: new Date(),
        }

        // Save to MongoDB
        const result = await ServiceCollection.insertOne(service)

        res.status(201).send({
            success: true,
            message: "Service created successfully",
            insertedId: result.insertedId,
        })

    } catch (error) {
        console.error("Create service error:", error)

        res.status(500).send({
            success: false,
            message: "Failed to create service",
        })
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


app.get("/My-services", async (req, res) => {
    try {
        const email = req.query.email;

        if (!email || typeof email !== "string") {
            return res.status(400).send({
                success: false,
                message: "Vendor email is required",
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        console.log("Email received from frontend:", normalizedEmail);

        const result = await ServiceCollection.find({
            vendorEmail: normalizedEmail,
        }).toArray();

        console.log("Services found:", result.length);

        res.status(200).send(result);

    } catch (error) {
        console.error("My-services error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to fetch services",
        });
    }
});


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});