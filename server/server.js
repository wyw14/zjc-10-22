const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3122;
const DATA_FILE = path.join(__dirname, 'questions.json');

app.use(cors());
app.use(express.json());

function readData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDayStartTimestamp(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isNewDay(data) {
  const todayStr = getDateString();
  const todayStart = getDayStartTimestamp();
  if (!data.currentQuestion || !data.currentQuestion.date) {
    return true;
  }
  return todayStart > data.currentQuestion.timestamp;
}

function selectQuestionForToday(data) {
  const todayStr = getDateString();
  const todayStart = getDayStartTimestamp();
  const bank = data.questionBank;

  let usedIds = [];
  if (data.answers) {
    usedIds = Object.values(data.answers)
      .filter(a => a && a.questionId)
      .map(a => a.questionId);
  }

  let available = bank.filter(q => !usedIds.includes(q.id));
  if (available.length === 0) {
    available = bank;
  }

  const seed = todayStart;
  const index = Math.abs(seed) % available.length;
  const selected = available[index];

  data.currentQuestion = {
    questionId: selected.id,
    question: selected.question,
    date: todayStr,
    timestamp: todayStart
  };

  if (!data.answers[todayStr]) {
    data.answers[todayStr] = {
      questionId: selected.id,
      question: selected.question,
      answer: '',
      answered: false,
      answeredAt: null
    };
  }

  writeData(data);
  return data.currentQuestion;
}

function ensureTodayQuestion(data) {
  if (isNewDay(data)) {
    return selectQuestionForToday(data);
  }
  const todayStr = getDateString();
  if (!data.answers[todayStr]) {
    data.answers[todayStr] = {
      questionId: data.currentQuestion.questionId,
      question: data.currentQuestion.question,
      answer: '',
      answered: false,
      answeredAt: null
    };
    writeData(data);
  }
  return data.currentQuestion;
}

app.get('/api/today', (req, res) => {
  try {
    const data = readData();
    const question = ensureTodayQuestion(data);
    const todayStr = getDateString();
    const todayAnswer = data.answers[todayStr] || { answer: '', answered: false };
    res.json({
      success: true,
      data: {
        question: question,
        answer: todayAnswer.answer,
        answered: todayAnswer.answered,
        date: todayStr
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

app.post('/api/answer', (req, res) => {
  try {
    const { answer } = req.body;
    if (typeof answer !== 'string') {
      return res.status(400).json({ success: false, message: '回答内容无效' });
    }
    const data = readData();
    ensureTodayQuestion(data);
    const todayStr = getDateString();

    data.answers[todayStr] = {
      questionId: data.currentQuestion.questionId,
      question: data.currentQuestion.question,
      answer: answer,
      answered: answer.trim().length > 0,
      answeredAt: answer.trim().length > 0 ? new Date().toISOString() : null
    };

    if (answer.trim().length > 0 && data.missedReasons && data.missedReasons[todayStr]) {
      delete data.missedReasons[todayStr];
    }

    writeData(data);
    res.json({
      success: true,
      data: {
        date: todayStr,
        answered: data.answers[todayStr].answered,
        answeredAt: data.answers[todayStr].answeredAt
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

app.get('/api/history', (req, res) => {
  try {
    const data = readData();
    const { year, month } = req.query;
    const y = year ? parseInt(year) : new Date().getFullYear();
    const m = month ? parseInt(month) : new Date().getMonth() + 1;

    const daysInMonth = new Date(y, m, 0).getDate();
    const calendar = [];

    const missedReasons = data.missedReasons || {};
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const entry = data.answers[dateStr];
      const hasMissedReason = !!(entry && !entry.answered && missedReasons[dateStr]);
      const missedReason = hasMissedReason ? missedReasons[dateStr] : null;
      calendar.push({
        date: dateStr,
        day: day,
        hasQuestion: !!entry,
        answered: !!(entry && entry.answered),
        answer: entry ? entry.answer : '',
        question: entry ? entry.question : '',
        hasMissedReason: hasMissedReason,
        missedReason: missedReason
      });
    }

    let answeredCount = 0;
    let missedCount = 0;
    const allDates = Object.keys(data.answers).sort();
    if (allDates.length > 0) {
      const firstDate = new Date(allDates[0]);
      const today = new Date();
      const todayStr = getDateString(today);
      let cursor = new Date(firstDate);
      while (cursor <= today) {
        const curStr = getDateString(cursor);
        const entry = data.answers[curStr];
        if (curStr !== todayStr) {
          if (entry && entry.answered) {
            answeredCount++;
          } else {
            missedCount++;
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    res.json({
      success: true,
      data: {
        calendar,
        year: y,
        month: m,
        stats: {
          answeredCount,
          missedCount,
          totalDays: answeredCount + missedCount
        },
        allAnswers: data.answers
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

app.get('/api/question-bank', (req, res) => {
  try {
    const data = readData();
    res.json({
      success: true,
      data: data.questionBank
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

app.get('/api/missed-reasons', (req, res) => {
  try {
    const data = readData();
    res.json({
      success: true,
      data: data.missedReasons || {}
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

app.post('/api/missed-reason', (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date || typeof reason !== 'string') {
      return res.status(400).json({ success: false, message: '参数无效' });
    }
    const todayStr = getDateString();
    if (date >= todayStr) {
      return res.status(400).json({ success: false, message: '只能为过去的日期添加断更说明' });
    }
    const data = readData();
    if (!data.answers[date]) {
      return res.status(400).json({ success: false, message: '该日期没有分配问题' });
    }
    if (data.answers[date].answered) {
      return res.status(400).json({ success: false, message: '该日期已回答，无需添加断更说明' });
    }
    if (!data.missedReasons) {
      data.missedReasons = {};
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) {
      delete data.missedReasons[date];
    } else {
      data.missedReasons[date] = {
        reason: trimmedReason,
        createdAt: data.missedReasons[date]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    writeData(data);
    res.json({
      success: true,
      data: data.missedReasons[date] || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

app.delete('/api/missed-reason/:date', (req, res) => {
  try {
    const { date } = req.params;
    if (!date) {
      return res.status(400).json({ success: false, message: '日期无效' });
    }
    const data = readData();
    if (!data.missedReasons) {
      data.missedReasons = {};
    }
    if (!data.missedReasons[date]) {
      return res.status(404).json({ success: false, message: '该日期没有断更说明' });
    }
    if (data.answers[date]?.answered) {
      return res.status(400).json({ success: false, message: '该日期已回答，无法删除断更说明' });
    }
    delete data.missedReasons[date];
    writeData(data);
    res.json({
      success: true
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

app.listen(PORT, () => {
  console.log(`每日问答后端服务已启动 http://localhost:${PORT}`);
  const data = readData();
  ensureTodayQuestion(data);
  console.log(`今日问题已准备就绪 ${data.currentQuestion.question}`);
});
