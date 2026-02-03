const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const session = require('express-session');
require('dotenv').config();

const connectDB = require('./config/db');
const User = require('./models/User');
const Note = require('./models/Note');

const app = express();
connectDB();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

const uploadDir = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'images')
    : path.join(__dirname, '..', 'DB', 'images');

fs.mkdirSync(uploadDir, { recursive: true });

app.use('/user/image', express.static(uploadDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '.jpeg');
    }
});
const upload = multer({ storage });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'register.html'));
});

app.post('/register', upload.single('profile'), async (req, res) => {
    const { name, email, password } = req.body;
    const profile = req.file ? req.file.filename : '';

    try {
        let existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).send('User already exists');
        }

        const user = new User({ name, email, password, profile });
        await user.save();

        res.redirect('/login');
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email, password });
        if (!user) {
            return res.redirect('/login');
        }

        req.session.user = { id: user._id, email: user.email };
        res.cookie('user', JSON.stringify({ id: user._id, email: user.email }));
        res.redirect('/Notes');
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.get('/Notes', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'Notes.html'));
});

app.get('/getUser', async (req, res) => {
    if (!req.cookies.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const user = JSON.parse(req.cookies.user);

    try {
        const dbUser = await User.findById(user.id);
        if (!dbUser) return res.status(404).json({ message: 'User not found' });

        res.json({
            id: dbUser._id,
            name: dbUser.name,
            email: dbUser.email,
            profile: dbUser.profile
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.post('/Notes', async (req, res) => {
    const { note, mood, tags, prompt } = req.body;
    const user = JSON.parse(req.cookies.user);

    try {
        let tagList = [];
        if (Array.isArray(tags)) {
            tagList = tags;
        } else if (typeof tags === 'string') {
            tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        }

        const newNote = new Note({
            userId: user.id,
            text: note,
            mood: mood || 'Neutral',
            tags: tagList,
            prompt: prompt || ''
        });

        await newNote.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.get('/getNotes', async (req, res) => {
    if (!req.cookies.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const user = JSON.parse(req.cookies.user);
    const { q, mood, tag, from, to } = req.query;

    try {
        const filter = { userId: user.id };

        if (q) {
            filter.text = { $regex: q, $options: 'i' };
        }

        if (mood) {
            filter.mood = mood;
        }

        if (tag) {
            filter.tags = { $in: [tag] };
        }

        if (from || to) {
            filter.time = {};
            if (from) filter.time.$gte = new Date(from);
            if (to) filter.time.$lte = new Date(to);
        }

        const notes = await Note.find(filter).sort({ time: -1 });
        res.json(notes);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.delete('/Notes/:id', async (req, res) => {
    if (!req.cookies.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    try {
        await Note.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.put('/Notes/:id', async (req, res) => {
    if (!req.cookies.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { note, mood, tags } = req.body;
    let tagList = [];

    if (Array.isArray(tags)) {
        tagList = tags;
    } else if (typeof tags === 'string') {
        tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    try {
        await Note.findByIdAndUpdate(req.params.id, {
            text: note,
            mood: mood || 'Neutral',
            tags: tagList,
            time: new Date().toISOString()
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.post('/changeP', async (req, res) => {
    const { Opass, Npass } = req.body;
    const user = JSON.parse(req.cookies.user);

    try {
        const dbUser = await User.findById(user.id);
        if (!dbUser) return res.json({ success: false });

        if (dbUser.password !== Opass)
            return res.json({ success: false, Message: 'wrong old password' });

        if (dbUser.password === Npass)
            return res.json({ success: false, Message: 'same password' });

        dbUser.password = Npass;
        await dbUser.save();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error });
    }
});

app.get('/done', (req, res) => {
    res.send('password changed successfully');
});

app.post('/logout', (req, res) => {
    req.session.destroy(error => {
        if (error) return res.status(500).json({ success: false, Message: 'logout failed' });
        res.clearCookie('connect.sid');
        res.json({ success: true, Message: 'logout successful' });
    });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server started at: http://localhost:${port}/home`);
});
