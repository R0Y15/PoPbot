export default {
    providers: [
        {
            domain: process.env.CLERK_JWT_ISSUER_DOMAIN || "https://your-issuer.clerk.accounts.dev",
            applicationID: "convex",
        },
    ],
};
