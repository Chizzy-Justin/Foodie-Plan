const express = require('express');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const session = require('express-session');

require('dotenv').config();

const app = express();
const port = process.env.port || 3000;


// const pool = new Pool({
//     user: 'postgres',
//     host: 'localhost',
//     database: 'food-tracker ',
//     password: process.env.PG_PASSWORD,
//     port: 5432,
// });


const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});


(async () => {
    try {
        const client = await pool.connect();
        console.log("Connected to the database successfully!");
        try {
            const createUsersTableQuery = `
              CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                firstName VARCHAR(50),
                lastName VARCHAR(50)
              );
            `;
        
            const createNotesTableQuery = `
              CREATE TABLE IF NOT EXISTS notes (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                note TEXT NOT NULL,
                created_at DATE DEFAULT CURRENT_DATE
              );
            `;
        
            const alterNotesTableQuery = `
              ALTER TABLE notes ADD COLUMN IF NOT EXISTS day_diff_from_epoch INT;
            `;
        
            const updateNotesTableQuery = `
              UPDATE notes
              SET day_diff_from_epoch = EXTRACT(EPOCH FROM created_at) / 86400;
            `;
        
            await client.query('BEGIN');
            await client.query(createUsersTableQuery);
            await client.query(createNotesTableQuery);
            await client.query(alterNotesTableQuery);
            await client.query(updateNotesTableQuery);
            await client.query('COMMIT');
        
            console.log('Tables created and columns updated successfully.');
          } catch (err) {
            await client.query('ROLLBACK');
            console.error('Error executing queries:', err);
          } finally {
            client.release();
          }
    } catch (error) {
        console.error("Error connecting to the database:", error);
    }
})();



// async function createTables() {
//   const client = await pool.connect();


// }

// createTables();



app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('views'));
app.use(express.static("public"));
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}));


app.set('view engine', 'ejs');


app.use(async (req, res, next) => {
    try {
        const userId = req.session?.user?.id; 
        if (userId) {
            const userResult = await pool.query(
                'SELECT id, username, firstname FROM users WHERE id = $1',
                [userId]
            );
            const user = userResult.rows[0] || null;
            res.locals.user = user;

            if (user) {
                const notesResult = await pool.query(
                    `SELECT day_diff_from_epoch, title, note, created_at 
                     FROM notes 
                     WHERE user_id = $1 
                     ORDER BY day_diff_from_epoch DESC`,
                    [userId]
                );
                const notes = notesResult.rows;


                let yesterday = Math.floor(Date.now() / (1000 * 60 * 60 * 24)); 
                const gaps = [];
                let hasGap = false;
                const processedDates = new Set(); 
                
                for (let note of notes) {
                    const noteDate = note.created_at.toLocaleDateString('en-CA'); 
                
                 
                    if (processedDates.has(noteDate)) {
                        continue; 
                    }
                
                 
                    if (note.day_diff_from_epoch < yesterday - 1) {
                        hasGap = true;
                        console.log('Gaps detected: ', gaps);
                        break; 
                    }
                
                 
                    // console.log('Yesterday:', yesterday);
                    // console.log('Processing:', note.day_diff_from_epoch);
                
                    gaps.push(noteDate); 
                    processedDates.add(noteDate); 
                    yesterday = note.day_diff_from_epoch; 
                }
                
                res.locals.notes = notes; 
                res.locals.gaps = gaps; 
                res.locals.hasGap = hasGap; 
                
            } else {
                res.locals.notes = [];
                res.locals.gaps = [];
                res.locals.hasGap = false;
            }
        } else {
            res.locals.user = null;
            res.locals.notes = [];
            res.locals.gaps = [];
            res.locals.hasGap = false;
        }
        next(); 
    } catch (error) {
        console.error('Error fetching user data or notes:', error);
        res.locals.user = null;
        res.locals.notes = [];
        res.locals.gaps = [];
        res.locals.hasGap = false;
        next();
    }
});




    
    
    app.get("/", (req, res) => {
        console.log('hom gaps ', res.locals.gaps);
        
        res.render('index.ejs', {
            user: res.locals.user,
            notes: res.locals.notes,
            gaps: res.locals.gaps,
            hasGap: res.locals.hasGap
        });
    });
    
    app.get('/about', (req, res) => {
        res.render('about.ejs', {
            user: res.locals.user,
            notes: res.locals.notes,
            gaps: res.locals.gaps,
            hasGap: res.locals.hasGap
        });
    });
    
    app.get('/notes', (req, res) => {
        res.render('notes.ejs', {
            user: res.locals.user,
            notes: res.locals.notes,
            gaps: res.locals.gaps,
            hasGap: res.locals.hasGap
        });
    });
    
    

app.get('/login', (req, res) => {
    res.render('login.ejs')
});

app.get('/signup', (req, res) => {
    res.render('signup.ejs')
});

app.get('/forgot-password', (req, res) => {
    res.status(501).send(`
        <html>
            <head><title>Feature Not Implemented</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h1>Forgot Password</h1>
                <p>This feature is not yet implemented.</p>
                <p>Please contact the admin or software engineer for assistance.</p>
                <a href="/">Back to homepage</a>.
            </body>
        </html>
    `);
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('Internal Server Error');
        }
       res.redirect('/');
    });
});

app.post('/signup', async (req, res) => {
    const { username, password, firstName, lastName} = req.body;

    try {
        if (!username || !password) {
            return res.status(400).send('Username and password are required.');
        }

        const existingUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(400).send('Username already exists.');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query('INSERT INTO users (username, password, firstName, lastName) VALUES ($1, $2, $3, $4)', [username, hashedPassword, firstName, lastName]);

        res.send('Registration successful! You can now <a href="/">log in</a>.');
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).send('Internal server error.');
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            return res.status(400).send('username not found! <a href="/login">Retry</a>.');
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).send('Invalid username or password! <a href="/login">Retry</a>.');
        }

      
        req.session.user = { id: user.id, username: user.username };
        res.redirect('/');
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).send('Internal server error');
    }
});
app.post('/foodNoteForm', async (req, res) => {
    try {
        const { FoodTitle, FoodNote } = req.body; 
        const userId = req.session?.user?.id; 
        if (!userId) {
            return res.status(401).send('Unauthorized: Please log in <a href="/">here</a>.');
        }

        
        if (!FoodTitle || !FoodNote) {
            return res.status(400).send('foodTitle and FoodNote are required.');
        }

await pool.query(
    `INSERT INTO notes (user_id, title, note, created_at, day_diff_from_epoch) 
     VALUES ($1, $2, $3, CURRENT_DATE, EXTRACT(EPOCH FROM CURRENT_DATE) / 86400)`,
    [userId, FoodTitle, FoodNote]
);


        res.redirect('/'); 
    } catch (error) {
        console.error('Error saving note:', error);
        res.status(500).send('Internal server error');
    }
});







app.listen(port, () => {
  console.log(`Server listening on port ${port}`);  
});