const allowedOrigins = [
    'http://localhost:3000',
    'https://conference.vgu.edu.vn/agenda'
];

const corsOptionsDelegate = function (req, callback) {
    const origin = req.header('Origin');
    const isAllowed = allowedOrigins.includes(origin);
    callback(null, {
        origin: isAllowed,
        credentials: false,
    });
};

module.exports = { corsOptionsDelegate };
