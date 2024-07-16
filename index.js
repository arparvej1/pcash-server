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

// Get current date and time ------------------- 
const getCurrentDateTime = () => {
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
  ];

  // Get current date and time in local time
  const currentDateTime = new Date();

  // Format date and time
  const day = currentDateTime.getDate().toString().padStart(2, '0');
  const month = months[currentDateTime.getMonth()];
  const year = currentDateTime.getFullYear();
  const time = currentDateTime.toLocaleTimeString('en-US', { hour12: true });

  return `${day}-${month}-${year}, ${time}`;
};



async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)

    const mainDB = client.db('pCash'); // << ----- main Database here -----
    const userCollection = mainDB.collection('users');
    const transactionsCollection = mainDB.collection('transactions');

    app.get('/users', verifyToken, async (req, res) => {
      const userEmail = req.decoded.email;
      const userAdmin = await userCollection.findOne({
        $or: [{ email: userEmail }]
      });

      if (userAdmin.role !== 'admin') {
        return res.status(401).send({ message: 'unauthorized access' });
      }

      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // Search users by name
    app.get('/users/search', verifyToken, async (req, res) => {
      const userEmail = req.decoded.email;
      // console.log(userEmail);
      const userAdmin = await userCollection.findOne({
        $or: [{ email: userEmail }]
      });

      if (userAdmin.role !== 'admin') {
        return res.status(401).send({ message: 'unauthorized access' });
      }

      const { name } = req.query;
      try {
        const users = await userCollection.find({ name: { $regex: name, $options: 'i' } }).toArray();
        res.json(users);
      } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Activate or block user
    app.put('/users/:userId/:action', verifyToken, async (req, res) => {
      const { userId, action } = req.params;
      const userEmail = req.decoded.email;
      // console.log(userEmail);
      const userAdmin = await userCollection.findOne({
        $or: [{ email: userEmail }]
      });

      if (userAdmin.role !== 'admin') {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      // -------------- give the bonus ------------
      const userReceiver = await userCollection.findOne({
        $or: [{ _id: new ObjectId(userId) }]
      });
      if (userReceiver.status === 'pending') {
        // --- balance update -----------
        await userCollection.updateOne(
          { _id: userReceiver._id },
          { $set: { balance: userReceiver.balance + userReceiver.role === 'agent' ? 10000 : 40 } }
        );

        // Function to generate a random alphanumeric string of specified length
        const generateTransactionId = (length) => {
          const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let result = '';
          for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
          }
          return result;
        };
        let newTransactionId;
        let checkNewTransactionId;

        // Loop until a unique transactionId is generated
        do {
          newTransactionId = generateTransactionId(10);
          checkNewTransactionId = await transactionsCollection.findOne({ transactionId: newTransactionId });
        } while (checkNewTransactionId);

        const newTransaction = {
          // senderMobile: userSender.mobileNumber,
          receiverMobile: userReceiver.mobileNumber,
          transactionTime: getCurrentDateTime(),
          transactionId: newTransactionId,
          transactionType: 'Bonus',
          amount: userReceiver.role === 'agent' ? 10000 : 40,
          senderSendMoneyFee: 0
        };

        await transactionsCollection.insertOne(newTransaction);
      }
      // --------------- give the bonus end ---------
      const validActions = ['activate', 'block'];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
      }
      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { status: action === 'activate' ? 'active' : 'blocked' } }
        );
        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        const updatedUser = await userCollection.findOne({ _id: new ObjectId(userId) });
        res.json(updatedUser);
      } catch (error) {
        console.error(`Error ${action}ing user:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // --- received user from client for userRegister
    app.post('/userRegister', async (req, res) => {
      const user = req.body;
      const { name, photo_url, email, mobileNumber, pin, userType } = user;

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

      const newUser = {
        name,
        photo_url,
        email,
        mobileNumber,
        pin: hashedPin,
        balance: 0,
        status: 'pending',
        role: userType,
        creationTime: getCurrentDateTime(),
        lastLogInTime: getCurrentDateTime()
      };

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
      if (user.status === 'blocked') {
        return res.status(400).send('user blocked');
      }

      await userCollection.updateOne(
        { _id: user._id },
        { $set: { lastLogInTime: getCurrentDateTime() } }
      );

      // Create a dynamic payload for the JWT token (excluding sensitive information)
      const payload = {
        name: user.name,
        email: user.email,
        mobileNumber: user.mobileNumber,
        role: user.role,
      };

      const token = jwt.sign(payload, process.env.JWT_ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.json({ token });
    });


    // --- received user from client for userCheck
    app.post('/userCheck', async (req, res) => {
      const { token } = req.body;
      // console.log('Received token:', token);

      try {
        jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET, async (err, decoded) => {
          if (err) {
            console.error('JWT verify error:', err);
            return res.status(401).send({ message: 'Unauthorized access' });
          }

          const userId = decoded;
          // console.log('Decoded user ID:', userId);

          const user = await userCollection.findOne({
            $or: [{ mobileNumber: userId.mobileNumber }, { email: userId.email }]
          });

          if (!user) {
            return res.status(400).send('User not found');
          }

          if (user.status === 'blocked') {
            return res.status(400).send('user blocked');
          }

          // Create a dynamic payload for the User
          const payload = Object.keys(user).reduce((acc, key) => {
            if (!['pin'].includes(key)) {
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

    // --- send money -----------------------------
    app.post('/send-money', verifyToken, async (req, res) => {
      const { emailOrMobile, pin, amount } = req.body;
      const userEmail = req.decoded.email;

      const userReceiver = await userCollection.findOne({
        $or: [{ mobileNumber: emailOrMobile }, { email: emailOrMobile }]
      });
      // console.log(userReceiver);

      const userSender = await userCollection.findOne({
        $or: [{ mobileNumber: userEmail }, { email: userEmail }]
      });
      // console.log(userSender);

      if (!userSender || !(await bcrypt.compare(pin, userSender.pin))) {
        return res.status(400).send('Invalid credentials');
      }

      if (userSender.mobileNumber === userReceiver.mobileNumber) {
        return res.status(400).send("You can't send money yourself!");
      }

      if (amount < 50) {
        return res.status(400).send('Transactions must be at least 50 Taka.');
      }

      if (userSender.balance < (amount + (amount > 100 ? 5 : 0))) {
        return res.status(400).send('Insufficient funds available.');
      }

      // --- balance update -----------
      await userCollection.updateOne(
        { _id: userSender._id },
        { $set: { balance: userSender.balance - (amount + (amount > 100 ? 5 : 0)) } }
      );

      await userCollection.updateOne(
        { _id: userReceiver._id },
        { $set: { balance: userReceiver.balance + amount } }
      );

      // Function to generate a random alphanumeric string of specified length
      const generateTransactionId = (length) => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
          result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
      };
      let newTransactionId;
      let checkNewTransactionId;

      // Loop until a unique transactionId is generated
      do {
        newTransactionId = generateTransactionId(10);
        checkNewTransactionId = await transactionsCollection.findOne({ transactionId: newTransactionId });
      } while (checkNewTransactionId);

      const newTransaction = {
        senderMobile: userSender.mobileNumber,
        receiverMobile: userReceiver.mobileNumber,
        transactionTime: getCurrentDateTime(),
        transactionId: newTransactionId,
        transactionType: 'Send Money',
        amount,
        senderSendMoneyFee: amount > 100 ? 5 : 0
      };

      const result = await transactionsCollection.insertOne(newTransaction);
      if (result.acknowledged) {
        res.send(newTransaction);
      } else {
        res.send(result);
      }
    });

    app.get('/my-transactions', verifyToken, async (req, res) => {
      const userEmail = req.decoded.email;

      const user = await userCollection.findOne({
        $or: [{ email: userEmail }]
      });

      let filter = {};
      if (user.mobileNumber) {
        filter = { $or: [{ senderMobile: user.mobileNumber }, { receiverMobile: user.mobileNumber }] }
      }

      const result = await transactionsCollection.find(filter).toArray();
      res.send(result);

    });

    app.get('/all-transactions', verifyToken, async (req, res) => {
      const userEmail = req.decoded.email;
      const user = await userCollection.findOne({
        $or: [{ email: userEmail }]
      });

      if (user.role !== 'admin') {
        return res.status(401).send({ message: 'unauthorized access' });
      }

      const result = await transactionsCollection.find().toArray();
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
app.get('/', (req, res) => {
  res.send('Server is running...')
});

app.listen(port, () => {
  console.log(`Server is running port: ${port}
  Link: http://localhost:${port}`);
});