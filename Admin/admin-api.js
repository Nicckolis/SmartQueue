// The PHP session controls access. Browser storage cannot grant admin access.
export async function adminRequest(file, data) {
    const options = { credentials: "same-origin", cache: "no-store" };
    if (data !== undefined) {
        options.method = "POST";
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(data);
    }
    const response = await fetch("../Backend/" + file, options);
    if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("The server did not return JSON. Open the site through the PHP server.");
    }
    const body = await response.json();
    if (!response.ok) {
        const error = new Error(body.error || "The request failed.");
        error.status = response.status;
        throw error;
    }
    return body;
}

export function adminErrorMessage(error) {
    if (error.status === 401) return "Please sign in using the PHP login. The old browser login does not create a server session.";
    if (error.status === 403) return "Your account does not have administrator access.";
    return error.message || "The operation failed.";
}
