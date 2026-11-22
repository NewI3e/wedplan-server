import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

const app = express();
const port = 5000;

//middleware
app.use(express.json());


const client = new MongoClient(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.othdrf.mongodb.net/`);


const allowedOrigins = (
    process.env.CLIENT_ORIGINS ||
    "http://localhost:3000,http://127.0.0.1:3000,https://wedplan-client-theta-khaki.vercel.app"
)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            
            if (!origin) {
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(
                new Error(`Origin not allowed by CORS: ${origin}`)
            );
        },
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

const connectClint = await connectToMongoDB();

const database = connectClint.db("wedplandb");
const users = database.collection("user");

const ServiceCollection = database.collection("services");

const BookingCollection = database.collection("bookings");


const SubscriptionCollection = database.collection("subscriptions");

const FREE_SERVICE_LIMIT = 3;

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}


async function getVendorPlan(email) {
    const vendorEmail = normalizeEmail(email);

    if (!vendorEmail) {
        return { plan: "free", subscription: null };
    }

    const now = new Date();

    const subscription = await SubscriptionCollection.findOne({
        vendorEmail,
        status: "active",
        $or: [
            { currentPeriodEnd: { $exists: false } },
            { currentPeriodEnd: null },
            { currentPeriodEnd: { $gt: now } },
        ],
    });

    if (!subscription) {
        return { plan: "free", subscription: null };
    }

    return { plan: subscription.plan || "premium", subscription };
}

/**
 * Pending, approved and paused services all count toward the limit

 */
async function countVendorServices(email) {
    return ServiceCollection.countDocuments({
        vendorEmail: normalizeEmail(email),
        status: { $ne: "rejected" },
    });
}

async function getServiceUsage(email) {
    const { plan } = await getVendorPlan(email);
    const used = await countVendorServices(email);
    const isFree = plan === "free";
    const limit = isFree ? FREE_SERVICE_LIMIT : null;

    return {
        plan,
        limit,
        used,
        remaining: limit === null ? null : Math.max(0, limit - used),
        canCreate: !isFree || used < FREE_SERVICE_LIMIT,
    };
}

app.get('/', (req, res) => {
    res.send('wedplan server!');
});

app.get('/users', async (req, res) => {
    const cursor = await users.find({});
    const result = await cursor.toArray();
    res.send(result);


})





app.post("/bookings", async (req, res) => {
    try {
        const {
            serviceId,
            customerEmail,
            eventDate,
            eventLocation,
            message,
        } = req.body;

        



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

        // Enforce the free plan limit 
        const normalizedVendorEmail = vendorEmail.trim().toLowerCase();
        const usage = await getServiceUsage(normalizedVendorEmail);

        if (!usage.canCreate) {
            return res.status(403).send({
                success: false,
                code: "SUBSCRIPTION_REQUIRED",
                message: `You've reached the Free plan limit of ${FREE_SERVICE_LIMIT} services. Subscribe to add more.`,
                usage,
            });
        }

        // Create service document
        const service = {
            name: name.trim(),
            category,
            location,
            price: Number(price),
            description: description.trim(),
            photoUrl: photoUrl || null,
            vendorEmail: normalizedVendorEmail,
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

// get total services count
// app.get('/services/count', async (req, res) => {
//   try {
//     const count = await ServiceCollection.countDocuments();
//     res.send({ count });
//   } catch (error) {
//     console.error("Error fetching services count:", error);
//     res.status(500).send({ error: "Failed to fetch services count" });
//   }
// });



// app.get('/services/count', async (req, res) => {
//   try {
//     const result = await ServiceCollection.aggregate([
//       {
//         $group: {
//           _id: "$vendorEmail",
//           count: { $sum: 1 }
//         }
//       },
//       {
//         $project: {
//           _id: 0,
//           vendorEmail: "$_id",
//           count: 1
//         }
//       }
//     ]).toArray();

//     res.send(result);
//   } catch (error) {
//     console.error("Error fetching services count:", error);
//     res.status(500).send({ error: "Failed to fetch services count" });
//   }
// });

app.get('/services/count', async (req, res) => {
    try {
        const { vendorEmail } = req.query;

        const query = {};

        if (vendorEmail) {
            query.vendorEmail = vendorEmail;
        }

        const count = await ServiceCollection.countDocuments(query);

        res.send({ count });
    } catch (error) {
        console.error("Error fetching services count:", error);
        res.status(500).send({ error: "Failed to fetch services count" });
    }
});



// Plan + usage for the vendor dashboard and the add-service form.
app.get('/services/usage', async (req, res) => {
    try {
        const { vendorEmail } = req.query;

        if (!vendorEmail || typeof vendorEmail !== "string") {
            return res.status(400).send({
                success: false,
                message: "Vendor email is required.",
            });
        }

        const usage = await getServiceUsage(vendorEmail);

        res.send({ success: true, ...usage });
    } catch (error) {
        console.error("Error fetching service usage:", error);
        res.status(500).send({ error: "Failed to fetch service usage" });
    }
});



app.delete('/services/:id', async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await ServiceCollection.deleteOne(query);
    res.send(result);
});

app.patch('/services/:id', async (req, res) => {
    try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid service id.",
            });
        }


        const editableFields = [
            "name",
            "category",
            "location",
            "price",
            "description",
            "photoUrl",
            "available",
        ];

        const updatedService = {};

        for (const field of editableFields) {
            if (req.body[field] !== undefined) {
                updatedService[field] = req.body[field];
            }
        }

        if (Object.keys(updatedService).length === 0) {
            return res.status(400).send({
                success: false,
                message: "No editable service fields were provided.",
            });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
            $set: updatedService,
        };
        const result = await ServiceCollection.updateOne(filter, updateDoc);
        res.send(result);
    } catch (error) {
        console.error("Update service error:", error);
        res.status(500).send({ error: "Failed to update service" });
    }
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


// Export the Express app
export default app;