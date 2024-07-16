const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://pcash-client.vercel.app',
    'https://pcash.netlify.app'
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


    // --- received user from client for userRegister
    app.post('/userRegister', async (req, res) => {
      const user = req.body;
      const { name, photo_url, email, mobileNumber, pin } = user;

      // Validate email and mobileNumber to prevent duplicates
      const existingUserWithEmail = await userCollection.findOne({ email: email });
      if (existingUserWithEmail) {
        return res.status(400).send({ error: 'Email already exists' });
      }

      const existingUserWithMobile = await userCollection.findOne({ mobileNumber: mobileNumber });
      if (existingUserWithMobile) {
        return res.status(400).send({ error: 'Mobile number already exists' });
      }

      const hashedPin = await bcrypt.hash(pin, 10);
      const newUser = { name, photo_url, email, mobileNumber, pin: hashedPin, balance: 0, status: 'pending', role: 'user' };

      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });


    // --- received user from client for userLogin
    app.post('/userLogin', async (req, res) => {
      const { emailOrMobile, pin } = req.body;

      const user = await userCollection.findOne({
        $or: [{ mobileNumber: emailOrMobile }, { email: emailOrMobile }]
      });
      if (!user || !(await bcrypt.compare(pin, user.pin))) {
        return res.status(400).send('Invalid credentials');
      }

      // Create a dynamic payload for the JWT token
      const payload = Object.keys(user).reduce((acc, key) => {
        if (!['pin', 'status', 'balance'].includes(key)) {
          acc[key] = user[key];
        }
        return acc;
      }, {});

      const token = jwt.sign(payload, process.env.JWT_ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.json({ token });
    });


    // --- received user from client for userCheck
    app.post('/userCheck', async (req, res) => {
      const { token } = req.body;
      console.log('Received token:', token);

      try {
        jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET, async (err, decoded) => {
          if (err) {
            console.error('JWT verify error:', err);
            return res.status(401).send({ message: 'Unauthorized access' });
          }

          const userId = decoded;
          console.log('Decoded user ID:', userId);

          const user = await userCollection.findOne({
            $or: [{ mobileNumber: userId.mobileNumber }, { email: userId.email }]
          });

          if (!user) {
            return res.status(400).send('User not found');
          }

          // Create a dynamic payload for the User
          const payload = Object.keys(user).reduce((acc, key) => {
            if (!['pin', 'status'].includes(key)) {
              acc[key] = user[key];
            }
            return acc;
          }, {});

          res.send(payload);
        });
      } catch (error) {
        console.error('Error in /userCheck:', error);
        res.status(500).send('Internal server error');
      }
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
app.get('/', (req, res) => {
  res.send('Server is running...')
});

app.listen(port, () => {
  console.log(`Server is running port: ${port}
  Link: http://localhost:${port}`);
});