const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://pcash-client.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());

const uri = `mongodb+srv://${process.env.MONGODB_PCASH_USER}:${process.env.MONGODB_PCASH_PASS}@cluster0.esbrpdb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


const verifyToken = (req, res, next) => {
  // console.log('inside verify token', req.headers.authorization);
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
  const token = req.headers.authorization.split(' ')[1];
  jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
};


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)

    //--------- creating Token
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    });

    app.post('/logout', async (req, res) => {
      const user = req.body;
      console.log('logging out', user);
      res.clearCookie('token', { maxAge: 0 }).send({ success: true })
    });
    const mainDB = client.db('pCash'); // << ----- main Database here -----
    const userCollection = mainDB.collection('users');

    app.get('/users/:email', verifyToken, async (req, res) => {
      console.log(req.params?.email);
      const userEmail = req.params?.email;
      if (req.user.email !== userEmail) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      let filter = {};
      if (req.params?.email) {
        filter = { email: userEmail }
      }
      const result = await userCollection.find(filter).toArray();
      if (result && result.length > 0) {
        res.send({ verifyUser: true });
      } else {
        res.send({ verifyUser: false });
      }
    });

    
    // --- received user from client
    app.post('/users', async (req, res) => {
      const user = req.body;
      console.log(user);
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);


// -------------- server run checking --------------------
app.get('/',  (req, res) => {
  res.send('Server is running...')
});

app.listen(port, ()=>{
  console.log(`Server is running port: ${port}
  Link: http://localhost:${port}`);
});