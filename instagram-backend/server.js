const express = require('express');
const cors = require('cors');
const { IgApiClient } = require('instagram-private-api');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 1111;

app.use(cors());
app.use(express.json());

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  try {
    await ig.simulate.preLoginFlow();
    const loggedInUser = await ig.account.login(username, password);
    process.nextTick(async () => await ig.simulate.postLoginFlow());

    // Save the session for future use
    const session = ig.state.serialize();
    // Remove sensitive data
    delete session.constants;

    res.json({ success: true, session });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(401).json({ success: false, message: 'Login failed. Please check your credentials and try again.' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
