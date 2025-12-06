// server.js - Express Backend with Supabase Integration
// COPY THIS ENTIRE FILE INTO YOUR backend/server.js

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Supabase Configuration
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(cors());
app.use(express.json());

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/x-python',
      'application/x-ipynb+json',
      'text/html',
    ];
    
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|zip|docx|py|ipynb|html)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// ==================== Authentication Middleware ====================
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
};

// ==================== User Routes ====================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, role } = req.body;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role || 'student'
        }
      }
    });

    if (error) throw error;

    // Create user profile in database
    const { error: profileError } = await supabase
      .from('users')
      .insert([
        {
          id: data.user.id,
          email: email,
          full_name: fullName,
          role: role || 'student',
          created_at: new Date()
        }
      ]);

    if (profileError) throw profileError;

    res.status(201).json({ 
      message: 'User registered successfully',
      user: data.user 
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    res.json({ 
      message: 'Login successful',
      session: data.session,
      user: data.user
    });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// Logout user
app.post('/api/auth/logout', authenticateUser, async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    res.json({ message: 'Logout successful' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== Assignment Routes ====================

// Get all assignments
app.get('/api/assignments', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('assignments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single assignment
app.get('/api/assignments/:id', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(404).json({ error: 'Assignment not found' });
  }
});

// Create new assignment (instructor only)
app.post('/api/assignments', authenticateUser, async (req, res) => {
  try {
    // Check if user is instructor
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (userData.role !== 'instructor') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { title, description, due_date, max_size, allowed_formats, points } = req.body;

    const { data, error } = await supabase
      .from('assignments')
      .insert([
        {
          title,
          description,
          due_date,
          max_size,
          allowed_formats,
          points,
          instructor_id: req.user.id,
          status: 'active',
          created_at: new Date()
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update assignment
app.put('/api/assignments/:id', authenticateUser, async (req, res) => {
  try {
    const { title, description, due_date, max_size, allowed_formats, points, status } = req.body;

    const { data, error } = await supabase
      .from('assignments')
      .update({
        title,
        description,
        due_date,
        max_size,
        allowed_formats,
        points,
        status,
        updated_at: new Date()
      })
      .eq('id', req.params.id)
      .eq('instructor_id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete assignment
app.delete('/api/assignments/:id', authenticateUser, async (req, res) => {
  try {
    const { error } = await supabase
      .from('assignments')
      .delete()
      .eq('id', req.params.id)
      .eq('instructor_id', req.user.id);

    if (error) throw error;

    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== Submission Routes ====================

// Get submissions for a user
app.get('/api/submissions/user/:userId', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('submissions')
      .select(`
        *,
        assignments (
          title,
          points,
          due_date
        )
      `)
      .eq('user_id', req.params.userId)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get submissions for an assignment
app.get('/api/submissions/assignment/:assignmentId', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('submissions')
      .select(`
        *,
        users (
          full_name,
          email
        )
      `)
      .eq('assignment_id', req.params.assignmentId)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit assignment
app.post('/api/submissions', authenticateUser, upload.single('file'), async (req, res) => {
  try {
    const { assignmentId } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get assignment details
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', assignmentId)
      .single();

    if (assignmentError) throw assignmentError;

    // Check if assignment is still open
    if (new Date(assignment.due_date) < new Date()) {
      return res.status(400).json({ error: 'Assignment deadline has passed' });
    }

    // Check file size
    if (file.size > assignment.max_size) {
      return res.status(400).json({ error: 'File size exceeds limit' });
    }

    // Upload file to Supabase Storage
    const fileName = `${req.user.id}/${assignmentId}/${Date.now()}_${file.originalname}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('assignments')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('assignments')
      .getPublicUrl(fileName);

    // Create submission record
    const { data: submissionData, error: submissionError } = await supabase
      .from('submissions')
      .insert([
        {
          assignment_id: assignmentId,
          user_id: req.user.id,
          file_name: file.originalname,
          file_size: file.size,
          file_path: fileName,
          file_url: urlData.publicUrl,
          status: 'submitted',
          submitted_at: new Date()
        }
      ])
      .select()
      .single();

    if (submissionError) throw submissionError;

    res.status(201).json({
      message: 'Assignment submitted successfully',
      submission: submissionData
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Grade submission (instructor only)
app.put('/api/submissions/:id/grade', authenticateUser, async (req, res) => {
  try {
    const { grade, feedback } = req.body;

    // Check if user is instructor
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (userData.role !== 'instructor') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('submissions')
      .update({
        grade,
        feedback,
        status: 'graded',
        graded_at: new Date()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Download submission file
app.get('/api/submissions/:id/download', authenticateUser, async (req, res) => {
  try {
    const { data: submission, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    // Check authorization
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (userData.role !== 'instructor' && submission.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('assignments')
      .download(submission.file_path);

    if (downloadError) throw downloadError;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${submission.file_name}"`);
    
    const buffer = Buffer.from(await fileData.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete submission
app.delete('/api/submissions/:id', authenticateUser, async (req, res) => {
  try {
    const { data: submission, error: fetchError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError) throw fetchError;

    // Delete file from storage
    const { error: storageError } = await supabase.storage
      .from('assignments')
      .remove([submission.file_path]);

    if (storageError) throw storageError;

    // Delete submission record
    const { error: deleteError } = await supabase
      .from('submissions')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) throw deleteError;

    res.json({ message: 'Submission deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/analytics/student/:userId', authenticateUser, async (req, res) => {
  try {
    const { data: submissions, error } = await supabase
      .from('submissions')
      .select(`
        *,
        assignments (
          points
        )
      `)
      .eq('user_id', req.params.userId);

    if (error) throw error;

    const stats = {
      totalSubmissions: submissions.length,
      gradedSubmissions: submissions.filter(s => s.status === 'graded').length,
      averageGrade: submissions.filter(s => s.grade !== null).length > 0
        ? submissions.reduce((acc, s) => acc + (s.grade || 0), 0) / submissions.filter(s => s.grade !== null).length
        : 0,
      totalPoints: submissions.filter(s => s.grade !== null).reduce((acc, s) => acc + (s.grade || 0), 0),
      possiblePoints: submissions.reduce((acc, s) => acc + (s.assignments?.points || 0), 0)
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/assignment/:assignmentId', authenticateUser, async (req, res) => {
  try {
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (userData.role !== 'instructor') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data: submissions, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', req.params.assignmentId);

    if (error) throw error;

    const stats = {
      totalSubmissions: submissions.length,
      gradedSubmissions: submissions.filter(s => s.status === 'graded').length,
      pendingSubmissions: submissions.filter(s => s.status === 'submitted').length,
      averageGrade: submissions.filter(s => s.grade !== null).length > 0
        ? submissions.reduce((acc, s) => acc + (s.grade || 0), 0) / submissions.filter(s => s.grade !== null).length
        : 0,
      highestGrade: Math.max(...submissions.map(s => s.grade || 0)),
      lowestGrade: Math.min(...submissions.filter(s => s.grade !== null).map(s => s.grade))
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Assignment Portal API is running!',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth/*',
      assignments: '/api/assignments/*',
      submissions: '/api/submissions/*',
      analytics: '/api/analytics/*'
    }
  });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size is too large' });
    }
  }
  res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 API available at http://localhost:${PORT}`);
});