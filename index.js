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


const myLogger = (req, res, next) => {
  console.log("Now Hitting API",req.url,req.headers,req.body);
  next();
}

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

const sessions = database.collection("session");

const jobs = database.collection("jobs");

const applications = database.collection("applications");

const savedJobs = database.collection("savedJobs");

const payments = database.collection("payments");


app.get("/", (req, res) => {
  res.send("HireLoop Server is running");
});


const verifyToken = async (req, res, next) => {
   const authHeader = req.headers.authorization;
   if (!authHeader) {
     return res.status(401).send({ message: "Unauthorized" });
     
   }
   const token = authHeader.split(" ")[1];

   if (!token) {
      return res.status(401).send({ message: "Unauthorized" });
   }

   const query = { token };
   const session = await sessions.findOne(query);
   if (!session) {
      return res.status(401).send({ message: "Unauthorized" });
   }

   const userId = session.userId;
   const userQuery = { _id: new ObjectId(userId) };
   const user = await users.findOne(userQuery);

   if (!user) {
      return res.status(401).send({ message: "Unauthorized" });
   }

    req.user = user;

   next();

}

// must call this middleware after verify Token
const verifySeeker = (req, res, next) => {
   if (req.user.role !== "seeker") {
      return res.status(403).send({ message: "Forbidden: You are not a job seeker." });
   }
   next();
}

const verifyRecruiter = (req, res, next) => {
   if (req.user.role !== "recruiter") {
      return res.status(403).send({ message: "Forbidden: You are not a recruiter." });
   }
    next();
  }


const verifyAdmin = (req, res, next) => {
   if (req.user.role !== "admin") {
      return res.status(403).send({ message: "Forbidden: You are not an admin." });
   }  
   next();
}


// users related API's
app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
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


app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
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
app.post("/jobs", verifyToken, verifyRecruiter, async (req, res) => {
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
app.get("/applications", verifyToken, async (req, res) => {

  console.log("Query parameters:", req.headers);

  const query = {};

  if (req.query.jobId) {

    const jobQuery = { _id: new ObjectId(req.query.jobId) };
    const job = await jobs.findOne(jobQuery);

    if (job.recruiterId !== req.user._id.toString() && req.user.role !== "admin") {
      res.status(403).send({ message: "Forbidden: You are not the recruiter for this job." });
      return;
    }

    query.jobId = req.query.jobId;
  } else {
    // No jobId → this is a "my applications" request. Force the session
    // user's id — never trust the client-sent applicantId.
    query.userId = req.user._id.toString();
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

app.post("/applications", verifyToken, verifySeeker, async (req, res) => {
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
    amount_total,
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
      // amount is in cents (Stripe amount_total); plan comes from the
      // checkout metadata so the admin dashboard can show it later.
      amount: amount_total ?? null,
      plan: metadata?.plan ?? null,
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


// Admin dashboard APIs (admins only)
app.get("/admin/stats", verifyToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({ message: "Forbidden: Admins only." });
  }

  const totalUsers = await users.countDocuments({});
  const totalRecruiters = await users.countDocuments({ role: "recruiter" });
  const totalJobs = await jobs.countDocuments({});

  // Companies are derived from job posts (no companies collection yet):
  // count distinct companyId, plus distinct company names on posts that
  // have no companyId.
  const companyIds = await jobs.distinct("companyId", {
    companyId: { $nin: [null, ""] },
  });
  const fallbackNames = await jobs.distinct("company", {
    companyId: { $in: [null, ""] },
    company: { $nin: [null, ""] },
  });
  const totalCompanies = companyIds.length + fallbackNames.length;

  // Revenue = sum of stored amounts (in cents) for paid payments.
  // Older payments recorded before `amount` was stored contribute 0.
  const revenueRows = await payments
    .aggregate([
      { $match: { payment_status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();

  res.send({
    totalUsers,
    totalRecruiters,
    totalCompanies,
    totalJobs,
    totalRevenue: revenueRows[0]?.total ?? 0,
  });
});

app.get("/payments", verifyToken, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({ message: "Forbidden: Admins only." });
  }

  const rows = await payments
    .find({})
    .sort({ payment_date: -1 })
    .limit(10)
    .toArray();

  // Attach the buyer's name from the user collection when possible.
  const withUsers = await Promise.all(
    rows.map(async (payment) => {
      let userName = null;
      if (payment.userId) {
        try {
          const user = await users.findOne({
            _id: new ObjectId(payment.userId),
          });
          userName = user?.name ?? null;
        } catch {
          // invalid/legacy id — just leave the name empty
        }
      }

      return {
        sessionId: payment.sessionId,
        customer_email: payment.customer_email,
        userName,
        plan: payment.plan ?? null,
        amount: payment.amount ?? null, // cents; null for old records
        payment_date: payment.payment_date,
        payment_status: payment.payment_status,
      };
    })
  );

  res.send(withUsers);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
})