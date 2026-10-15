// Each course has its own 40 questions and 40 answers.
// Question format (same as questions.js):
//   { topic: "...", question: "...", options: ["A", "B", "C", "D"] }
// Answer format: the number of the correct option (0 = first option, 1 = second, ...).
//
// Your existing questions.js / answers.js are used for Aqidah.
// Fill in the other courses the same way.

const COURSES = {

    "Tajwīd": {
        questions: [],
        answers: []
    },

    "Aqidah": {
        questions: (typeof QUESTIONS !== "undefined") ? QUESTIONS : [],
        answers: (typeof ANSWERS !== "undefined") ? ANSWERS : []
    },

    "Fiqh": {
        questions: [],
        answers: []
    },

    "Sīrah": {
        questions: [],
        answers: []
    },

    "Adab": {
        questions: [],
        answers: []
    },

    "Arabic Grammar": {
        questions: [],
        answers: []
    },

    "Arabic Morphology": {
        questions: [],
        answers: []
    },

    "Arabic Rhetoric": {
        questions: [],
        answers: []
    }

};
