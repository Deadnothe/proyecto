module.exports = {
    apps: [{
        name: 'video-upload',
        script: 'server.js',
        instances: 'max',
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'production',
            PORT: 3000,
            AWS_REGION: 'us-east-1',
            AWS_ACCESS_KEY_ID: 'AKIAZECM4U3V26I7CYR5',
            AWS_SECRET_ACCESS_KEY: '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',
            AWS_S3_BUCKET: 'videospeco',
            DATABASE_URL: 'postgres://u5huhv6ke527fg:pbaedaecad5cf632e732605c2d05af871ca1a812110cf88510fcdc8692ea254b6@cb681qjlulc2v0.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com:5432/db1hk62606g23v'
        },
    }],
};
