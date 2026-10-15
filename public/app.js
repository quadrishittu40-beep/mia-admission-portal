import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


// ===============================
// FIREBASE
// ===============================

const firebaseConfig = {
    apiKey: "AIzaSyCURm6jh7o3Ktv_ogZF9W7R6fikeggOjng",
    authDomain: "maknazul--irfan-cbt-portal.firebaseapp.com",
    projectId: "maknazul--irfan-cbt-portal",
    storageBucket: "maknazul--irfan-cbt-portal.firebasestorage.app",
    messagingSenderId: "308074980572",
    appId: "1:308074980572:web:17fdbd56f51e8a5b23c019",
    measurementId: "G-SM2QYM85X6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CANDIDATES = "candidates";
const RESULTS = "results";

let currentCandidate = null;
let currentCourse = "";
let examQuestions = [];
let timer = null;
let timeLeft = 20 * 60;


// ===============================
// HELPERS
// ===============================

function esc(text) {
    return String(text).replace(/[&<>"']/g, function(c) {
        return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[c];
    });
}


// ===============================
// PAGE CONTROL
// ===============================

function hidePages() {
    document.getElementById("home").classList.add("hidden");
    document.getElementById("exam").classList.add("hidden");
    document.getElementById("result").classList.add("hidden");
    document.getElementById("admin").classList.add("hidden");
}


function showHome() {
    clearInterval(timer);

    // Log the admin out whenever we return home
    if (auth.currentUser) {
        signOut(auth);
    }

    hidePages();

    document.getElementById("home").classList.remove("hidden");
}


function showAdmin() {
    hidePages();

    document.getElementById("admin").classList.remove("hidden");

    document.getElementById("adminLoginBox").classList.remove("hidden");
    document.getElementById("adminArea").classList.add("hidden");
}


// ===============================
// FIRESTORE DATA
// ===============================

async function getCandidates() {
    const snapshot = await getDocs(collection(db, CANDIDATES));

    const list = snapshot.docs.map(function(d) {
        return d.data();
    });

    list.sort(function(a, b) {
        return a.examNumber.localeCompare(b.examNumber);
    });

    return list;
}


async function getResults() {
    const snapshot = await getDocs(collection(db, RESULTS));

    const list = snapshot.docs.map(function(d) {
        return d.data();
    });

    list.sort(function(a, b) {
        return (a.timestamp || 0) - (b.timestamp || 0);
    });

    return list;
}


// ===============================
// ADMIN LOGIN
// ===============================

async function adminLogin() {

    const email =
        document.getElementById("adminEmail").value.trim();

    const password =
        document.getElementById("adminPassword").value;

    if (!email || !password) {
        alert("Please enter the admin email and password.");
        return;
    }

    try {

        await signInWithEmailAndPassword(auth, email, password);

        document.getElementById("adminLoginBox")
            .classList.add("hidden");

        document.getElementById("adminArea")
            .classList.remove("hidden");

        document.getElementById("adminPassword").value = "";

        await loadCandidates();
        await loadResults();

        alert("Admin login successful.");

    } catch (error) {

        console.error(error);

        alert("Incorrect admin email or password.");

    }
}


// ===============================
// GENERATE EXAM NUMBER
// ===============================

function generateExamNumber(candidates) {

    let highest = 0;

    candidates.forEach(function(candidate) {

        const part =
            parseInt(candidate.examNumber.split("-").pop(), 10);

        if (!isNaN(part) && part > highest) {
            highest = part;
        }

    });

    const number =
        String(highest + 1).padStart(4, "0");

    return "MIA-2026-" + number;
}


// ===============================
// REGISTER CANDIDATE
// ===============================

async function registerCandidate() {

    const name =
        document.getElementById("candidateName")
            .value.trim();

    const surname =
        document.getElementById("candidateSurname")
            .value.trim();

    const candidateClass =
        document.getElementById("candidateClass")
            .value;

    const message =
        document.getElementById("registrationMessage");


    if (!name || !surname || !candidateClass) {

        message.className = "error";

        message.textContent =
            "Please complete all candidate registration fields.";

        return;
    }


    try {

        const candidates = await getCandidates();


        // Prevent duplicate candidate details
        const duplicate = candidates.find(function(candidate) {

            return (
                candidate.name.toLowerCase() === name.toLowerCase() &&
                candidate.surname.toLowerCase() === surname.toLowerCase() &&
                candidate.class === candidateClass
            );

        });


        if (duplicate) {

            message.className = "error";

            message.textContent =
                "This candidate is already registered. Exam Number: " +
                duplicate.examNumber;

            return;
        }


        const examNumber = generateExamNumber(candidates);


        const candidate = {

            examNumber: examNumber,

            name: name,

            surname: surname,

            class: candidateClass,

            attemptedCourses: [],

            registeredAt: new Date().toLocaleString()

        };


        await setDoc(doc(db, CANDIDATES, examNumber), candidate);


        message.className = "success";

        message.innerHTML =
            "<strong>Candidate Registered Successfully</strong><br>" +
            "Exam Number: <strong>" + esc(examNumber) + "</strong><br>" +
            "Name: " + esc(name) + "<br>" +
            "Class: " + esc(candidateClass);


        document.getElementById("candidateName").value = "";
        document.getElementById("candidateSurname").value = "";
        document.getElementById("candidateClass").value = "";


        await loadCandidates();

    } catch (error) {

        console.error(error);

        message.className = "error";

        message.textContent =
            "Could not register candidate. Check your internet connection and try again.";

    }
}


// ===============================
// LOAD CANDIDATES
// ===============================

async function loadCandidates() {

    const table =
        document.getElementById("candidateTable");

    table.innerHTML =
        "<tr><td colspan='4'>Loading...</td></tr>";

    let candidates = [];

    try {

        candidates = await getCandidates();

    } catch (error) {

        console.error(error);

        table.innerHTML =
            "<tr><td colspan='4'>Could not load candidates.</td></tr>";

        return;
    }

    table.innerHTML = "";


    if (candidates.length === 0) {

        table.innerHTML =
            "<tr><td colspan='4'>No candidates registered yet.</td></tr>";

        return;
    }


    candidates.forEach(function(candidate) {

        const row = document.createElement("tr");

        const done = candidate.attemptedCourses || [];

        const status =
            done.length
                ? "<span class='status-completed'>" + esc(done.join(", ")) + "</span>"
                : "<span class='status-pending'>NOT ATTEMPTED</span>";


        row.innerHTML =

            "<td>" + esc(candidate.examNumber) + "</td>" +

            "<td>" + esc(candidate.name) + "</td>" +

            "<td>" + esc(candidate.class) + "</td>" +

            "<td>" + status + "</td>";


        table.appendChild(row);

    });
}


// ===============================
// CANDIDATE LOGIN
// ===============================

async function candidateLogin() {

    const examNumber =
        document.getElementById("loginExamNumber")
            .value.trim().toUpperCase();

    const name =
        document.getElementById("loginName")
            .value.trim();

    const surname =
        document.getElementById("loginSurname")
            .value.trim();

    const candidateClass =
        document.getElementById("loginClass")
            .value;

    const course =
        document.getElementById("loginCourse")
            .value;

    const message =
        document.getElementById("loginMessage");


    if (!examNumber || !name || !surname || !candidateClass || !course) {

        message.className = "error";

        message.textContent =
            "Please enter your Exam Number, Full Name, Surname, Class and Course.";

        return;
    }


    message.className = "";
    message.textContent = "Checking details...";


    let candidate = null;

    try {

        const snapshot =
            await getDoc(doc(db, CANDIDATES, examNumber));

        if (snapshot.exists()) {
            candidate = snapshot.data();
        }

    } catch (error) {

        console.error(error);

        message.className = "error";

        message.textContent =
            "Could not connect. Check your internet connection and try again.";

        return;
    }


    if (
        !candidate ||
        candidate.name.toLowerCase() !== name.toLowerCase() ||
        candidate.surname.toLowerCase() !== surname.toLowerCase() ||
        candidate.class !== candidateClass
    ) {

        message.className = "error";

        message.textContent =
            "Candidate details do not match the registration records.";

        return;
    }


    if ((candidate.attemptedCourses || []).includes(course)) {

        message.className = "error";

        message.textContent =
            "This candidate has already completed the " + course + " examination. A second attempt is not allowed.";

        return;
    }


    message.textContent = "";

    currentCandidate = candidate;

    currentCourse = course;

    startExam();
}


// ===============================
// START EXAM
// ===============================

function startExam() {

    if (typeof COURSES === "undefined" || !COURSES[currentCourse]) {

        alert(
            "Questions for this course could not be loaded."
        );

        return;
    }


    const courseData = COURSES[currentCourse];


    if (courseData.questions.length !== 40) {

        alert(
            "The " + currentCourse +
            " questions are not ready yet (" +
            courseData.questions.length +
            " of 40 added). Please contact your teacher."
        );

        return;
    }


    if (courseData.answers.length !== 40) {

        alert(
            "The " + currentCourse +
            " answers are not ready yet (" +
            courseData.answers.length +
            " of 40 added). Please contact your teacher."
        );

        return;
    }


    // Create a fresh copy of the questions
    examQuestions = courseData.questions.map(function(question, index) {

        const options = question.options.map(function(option, optionIndex) {

            return {

                text: option,

                correct:
                    optionIndex === courseData.answers[index]

            };

        });


        shuffle(options);


        return {

            topic: question.topic,

            question: question.question,

            options: options

        };

    });


    // Randomize question order
    shuffle(examQuestions);


    timeLeft = 20 * 60;


    hidePages();

    document.getElementById("exam")
        .classList.remove("hidden");


    document.getElementById("examStudent")
        .textContent =
        currentCandidate.name +
        " — " +
        currentCandidate.class;


    document.getElementById("examNumberDisplay")
        .textContent =
        "Exam Number: " +
        currentCandidate.examNumber +
        " | Course: " +
        currentCourse;


    document.getElementById("timer")
        .textContent = "20:00";


    showQuestions();

    updateProgress();

    startTimer();
}


// ===============================
// DISPLAY QUESTIONS
// ===============================

function showQuestions() {

    const container =
        document.getElementById("questionsContainer");

    container.innerHTML = "";


    examQuestions.forEach(function(question, index) {

        const questionBox =
            document.createElement("div");

        questionBox.className = "question";


        let optionsHTML = "";


        question.options.forEach(function(option, optionIndex) {

            optionsHTML +=

                '<label class="option">' +

                '<input ' +

                'type="radio" ' +

                'name="question_' + index + '" ' +

                'value="' + optionIndex + '" ' +

                'onchange="updateProgress()">' +

                option.text +

                '</label>';

        });


        questionBox.innerHTML =

            '<div class="topic">' +
            question.topic +
            '</div>' +

            '<h3>' +
            (index + 1) +
            ". " +
            question.question +
            '</h3>' +

            optionsHTML;


        container.appendChild(questionBox);

    });
}


// ===============================
// PROGRESS
// ===============================

function updateProgress() {

    let answered = 0;


    for (let i = 0; i < examQuestions.length; i++) {

        const selected =
            document.querySelector(
                'input[name="question_' + i + '"]:checked'
            );


        if (selected) {

            answered++;

        }

    }


    document.getElementById("progress")
        .textContent =
        "Questions answered: " +
        answered +
        " / 40";
}


// ===============================
// TIMER
// ===============================

function startTimer() {

    clearInterval(timer);


    timer = setInterval(function() {

        timeLeft--;

        updateTimer();


        if (timeLeft <= 0) {

            clearInterval(timer);

            alert(
                "Time is over. Your examination will be submitted automatically."
            );

            submitExam(true);

        }

    }, 1000);

}


function updateTimer() {

    const minutes =
        Math.floor(timeLeft / 60);

    const seconds =
        timeLeft % 60;


    document.getElementById("timer")
        .textContent =

        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0");
}


// ===============================
// SUBMIT EXAM
// ===============================

async function submitExam(autoSubmit) {

    if (!currentCandidate) {

        alert("Candidate information is missing.");

        return;
    }


    if (!autoSubmit) {

        const confirmed =
            confirm(
                "Are you sure you want to submit your examination?"
            );


        if (!confirmed) {

            return;

        }

    }


    clearInterval(timer);


    let score = 0;


    for (let i = 0; i < examQuestions.length; i++) {

        const selected =
            document.querySelector(
                'input[name="question_' + i + '"]:checked'
            );


        if (!selected) {

            continue;

        }


        const selectedIndex =
            Number(selected.value);


        if (
            examQuestions[i]
                .options[selectedIndex]
                .correct
        ) {

            score++;

        }

    }


    const percentage =
        Math.round((score / 40) * 100);


    try {

        // Mark candidate as attempted
        await updateDoc(
            doc(db, CANDIDATES, currentCandidate.examNumber),
            {
                attemptedCourses: arrayUnion(currentCourse),
                completedAt: new Date().toLocaleString()
            }
        );


        // Save result
        await addDoc(collection(db, RESULTS), {

            examNumber:
                currentCandidate.examNumber,

            student:
                currentCandidate.name,

            class:
                currentCandidate.class,

            course:
                currentCourse,

            score:
                score,

            total:
                40,

            percentage:
                percentage,

            date:
                new Date().toLocaleString(),

            timestamp:
                Date.now()

        });

    } catch (error) {

        console.error(error);

        alert(
            "Your result could not be saved. Please show this screen to your teacher."
        );

    }


    showResult(
        score,
        percentage
    );
}


// ===============================
// RESULT PAGE
// ===============================

function showResult(score, percentage) {

    hidePages();


    document.getElementById("result")
        .classList.remove("hidden");


    document.getElementById("resultExamNumber")
        .textContent =
        "Exam Number: " +
        currentCandidate.examNumber;


    document.getElementById("resultStudent")
        .textContent =
        currentCandidate.name +
        " — " +
        currentCandidate.class +
        " — " +
        currentCourse;


    document.getElementById("resultScore")
        .textContent =
        score +
        " / 40";


    document.getElementById("resultPercentage")
        .textContent =
        percentage +
        "%";


    let message = "";


    if (percentage >= 70) {

        message =
            "Excellent performance! Keep learning and improving.";

    } else if (percentage >= 50) {

        message =
            "Good effort. Continue studying " + currentCourse + ".";

    } else {

        message =
            "Keep studying and revise your " + currentCourse + " lessons carefully.";

    }


    document.getElementById("resultMessage")
        .textContent = message;
}


// ===============================
// LOAD RESULTS
// ===============================

async function loadResults() {

    const table =
        document.getElementById("resultsTable");

    table.innerHTML =
        "<tr><td colspan='7'>Loading...</td></tr>";

    let results = [];

    try {

        results = await getResults();

    } catch (error) {

        console.error(error);

        table.innerHTML =
            "<tr><td colspan='7'>Could not load results.</td></tr>";

        return;
    }

    table.innerHTML = "";


    if (results.length === 0) {

        table.innerHTML =
            "<tr><td colspan='7'>No examination results yet.</td></tr>";

        return;
    }


    results.forEach(function(result) {

        const row =
            document.createElement("tr");


        row.innerHTML =

            "<td>" +
            esc(result.examNumber) +
            "</td>" +

            "<td>" +
            esc(result.student) +
            "</td>" +

            "<td>" +
            esc(result.class) +
            "</td>" +

            "<td>" +
            esc(result.course || "-") +
            "</td>" +

            "<td>" +
            result.score +
            " / " +
            result.total +
            "</td>" +

            "<td>" +
            result.percentage +
            "%</td>" +

            "<td>" +
            esc(result.date) +
            "</td>";


        table.appendChild(row);

    });
}


// ===============================
// CLEAR ALL DATA
// ===============================

async function clearAllData() {

    const confirmed =
        confirm(
            "WARNING: This will delete ALL registered candidates and ALL examination results. Continue?"
        );


    if (!confirmed) {

        return;

    }


    try {

        const candidateDocs =
            await getDocs(collection(db, CANDIDATES));

        const resultDocs =
            await getDocs(collection(db, RESULTS));


        await Promise.all(
            candidateDocs.docs.concat(resultDocs.docs).map(function(d) {
                return deleteDoc(d.ref);
            })
        );


        await loadCandidates();

        await loadResults();


        alert(
            "All candidates and examination results have been cleared."
        );

    } catch (error) {

        console.error(error);

        alert(
            "Could not clear the data. Make sure you are logged in as admin."
        );

    }
}


// ===============================
// SHUFFLE
// ===============================

function shuffle(array) {

    for (
        let i = array.length - 1;
        i > 0;
        i--
    ) {

        const j =
            Math.floor(
                Math.random() * (i + 1)
            );


        const temporary =
            array[i];

        array[i] =
            array[j];

        array[j] =
            temporary;

    }


    return array;
}


// ===============================
// MAKE FUNCTIONS AVAILABLE TO THE BUTTONS
// (module scripts keep functions private otherwise)
// ===============================

window.showHome = showHome;
window.showAdmin = showAdmin;
window.adminLogin = adminLogin;
window.registerCandidate = registerCandidate;
window.candidateLogin = candidateLogin;
window.submitExam = submitExam;
window.clearAllData = clearAllData;
window.updateProgress = updateProgress;
