import { useAuth0 } from '@auth0/auth0-react';

function AuthButton() {
    // 🔓 DEV BYPASS
    // const { isAuthenticated, isLoading, user, loginWithRedirect, logout } = useAuth0();
    const isAuthenticated = true;
    const isLoading = false;
    const user = { name: "Dev Mode" };

    if (isLoading) {
        console.log('[AuthButton] Auth0 is loading...');
        return <button disabled>Loading...</button>;
    }

    if (isAuthenticated) {
        console.log('[AuthButton] User authenticated:', user);
        return (
            <div>
                <span>{user?.name || user?.email}</span>
                <button
                    onClick={() => {
                        console.log('[AuthButton] Logout clicked (disabled for demo)');
                        window.location.reload(); // Simple refresh for demo logout
                    }}
                >
                    Log Out
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => {
                console.log('[AuthButton] Redirecting to Auth0 login...');
                loginWithRedirect();
            }}
        >
            Log In
        </button>
    );
}

export default AuthButton;
