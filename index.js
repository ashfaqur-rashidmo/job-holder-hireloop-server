import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import "dotenv/config";
import Stripe from "stripe";


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

const PORT = process.env.PORT || 5000;


// Middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(`mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-onjifew-shard-00-00.qrw9kll.mongodb.net:27017,ac-onjifew-shard-00-01.qrw9kll.mongodb.net:27017,ac-onjifew-shard-00-02.qrw9kll.mongodb.net:27017/?ssl=true&replicaSet=atlas-11745k-shard-0&authSource=admin`);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB");
        return client;
    }
    catch (error) {
        console.error("Error connecting to MongoDB:", error);
    }
}

const connectedClient = await connectToMongoDB();

const database = connectedClient.db("hireloopdb");

const users = database.collection("user");

const jobs = database.collection("jobs");

const applications = database.collection("applications");

const savedJobs = database.collection("savedJobs");

const payments = database.collection("payments");


app.get("/", (req, res) => {
  res.send("HireLoop Server is running");
});


// users related API's
app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
})


app.get("/users/:id/premium", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await users.findOne(query, { projection: { premium: 1 } });
  res.send({ result });
})


app.patch("/users/:id/role", async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;

  // Only these three roles are allowed.
  if (!["seeker", "recruiter", "admin"].includes(role)) {
    return res.status(400).send({ message: "Invalid role." });
  }

  const query = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: { role },
  };
  const result = await users.updateOne(query, updateDoc);
  res.send(result);
});


// jobs related API's
// jobs send into database
app.post("/jobs", async (req, res) => {
  const job = req.body;
  const result = await jobs.insertOne(job);
  res.send(result);
})


// Update a job post (recruiter edit)
app.put("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const update = { ...req.body };
  delete update._id;

  const result = await jobs.updateOne(
    { _id: new ObjectId(id) },
    { $set: update }
  );
  res.send(result);
})



// Get jobs with filters and case-insensitive search
app.get("/jobs", async (req, res) => {
  const query = {};

  // Filter by job type
  if (req.query.jobType) {
    query.jobType = req.query.jobType;
  }

  // Filter by remote status
  if (req.query.isRemote !== undefined) {
    query.isRemote = req.query.isRemote === "true";
  }

  if (req.query.category) {
    query.category = req.query.category;
  }

  // Filter by recruiter (owner) — each recruiter sees only their own posts
  if (req.query.recruiterId) {
    query.recruiterId = req.query.recruiterId;
  }

  // Search by title, responsibilities, and qualifications
  if (req.query.search) {
    const searchText = req.query.search;

    query.$or = [
      { title: { $regex: searchText, $options: "i" } },
      { company: { $regex: searchText, $options: "i" } },
      { responsibilities: { $regex: searchText, $options: "i" } },
      { qualifications: { $regex: searchText, $options: "i" } },
    ];
  }

  console.log("Query:", query);

  const cursor = jobs.find(query);
  const result = await cursor.toArray();

  res.send(result);
});


// Count a recruiter's job posts — used for the free-plan (5 posts) limit
app.get("/jobs/count", async (req, res) => {
  const query = {};

  if (req.query.recruiterId) {
    query.recruiterId = req.query.recruiterId;
  }

  const count = await jobs.countDocuments(query);
  res.send({ count });
})


// Get a single job by id
app.get("/jobs/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid job id" });
  }

  const job = await jobs.findOne({ _id: new ObjectId(id) });

  if (!job) {
    return res.status(404).send({ message: "Job not found" });
  }

  res.send(job);
});


app.delete("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await jobs.deleteOne(query);
  res.send(result);
})


// app.patch("/jobs/:id", async (req, res) => {
//   const id = req.params.id;
//   const updatedJob = req.body;
  
//   const query = { _id: new ObjectId(id) };
//   const updateDoc = {
//     $set: updatedJob,
//   };

//   const result = await jobs.updateOne(query, updateDoc);
//   res.send(result);
// })


// application related API
app.get("/applications", async (req, res) => {
  const query = {};

  if (req.query.jobId) {
    query.jobId = req.query.jobId;
  }

  const cursor = applications.find(query);
  const result = await cursor.toArray();
  res.send(result);
});


app.get("/applications/count", async (req, res) => {
  const query = {};

  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }

 const result = await applications.countDocuments(query);
  res.send({count: result});
});

app.post("/applications", async (req, res) => {
  const application = req.body;

  if (!application?.jobId || !application?.userId) {
    return res
      .status(400)
      .send({ message: "jobId and userId are required." });
  }

  const existingApplication = await applications.findOne({
    jobId: application.jobId,
    userId: application.userId,
  });

  if (existingApplication) {
    return res.status(409).send({
      message: "You have already applied for this job.",
      applicationId: existingApplication._id,
    });
  }

  const applicationToSave = {
    ...application,
    appliedAt: application.appliedAt || new Date().toISOString(),
    status: application.status || "Applied",
    archived: application.archived ?? false,
    interviewDate: application.interviewDate ?? null,
  };

  const result = await applications.insertOne(applicationToSave);
  res.status(201).send(result);
});


// saved jobs related API
app.get("/saved-jobs", async (req, res) => {
  const query = {};

  if (req.query.userId) {
    query.userId = req.query.userId;
  }

  if (req.query.jobId) {
    query.jobId = req.query.jobId;
  }

  const result = await savedJobs.find(query).toArray();
  res.send(result);
});


app.post("/saved-jobs", async (req, res) => {
  const savedJob = req.body;

  if (!savedJob?.jobId || !savedJob?.userId) {
    return res.status(400).send({ message: "jobId and userId are required." });
  }

  const existingSavedJob = await savedJobs.findOne({
    jobId: savedJob.jobId,
    userId: savedJob.userId,
  });

  if (existingSavedJob) {
    return res.status(409).send({
      message: "You have already saved this job.",
      savedJobId: existingSavedJob._id,
    });
  }

  const savedJobToSave = {
    ...savedJob,
    savedAt: savedJob.savedAt || new Date().toISOString(),
  };

  const result = await savedJobs.insertOne(savedJobToSave);
  res.status(201).send(result);
});

app.delete("/saved-jobs", async (req, res) => {
  const { userId, jobId } = req.query;

  if (!userId || !jobId) {
    return res.status(400).send({ message: "userId and jobId are required." });
  }

  const result = await savedJobs.deleteOne({ userId, jobId });
  res.send(result);
});



// payments related API
app.post("/payments/checkout-verify", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).send({ message: "sessionId is required." });
  }


  const {
    status,
    payment_status,
    customer_email,
    metadata,
    payment_intent,
  } = await stripe.checkout.sessions.retrieve(sessionId);

  //1. is it new session or never used

  // 2. is the session id for the currently logged in user

  // 3. insert session id into the payment collection

  // 4. update user information as premium user

  if (status === "complete" && payment_status === "paid") {

    const sessionQuery = {sessionId}

    const existingPayment = await payments.findOne(sessionQuery);

    if (existingPayment) {
      return res.send({ success: false, message: "Payment already verified" });
    }

    const payment = {
      sessionId,
      status,
      payment_status,
      customer_email,
      userId: metadata?.userId ?? null,
      payment_date: new Date(),
      payment_intent,
    }

    const result = await payments.insertOne(payment);

    // update the user table
    let updateResult = null;
    if (metadata?.userId) {
      const query = { _id: new ObjectId(metadata.userId) };

      const updatedDoc = {
        $set: {
          premium: true,
        }
      }

      updateResult = await users.updateOne(
        query, updatedDoc);
    }

    res.send({ success: true, result, updateResult, message: "Payment successful and user upgraded to premium" });

    return;
  }

  return res.send({ success: false, message: "Payment not successful" });
})


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
})