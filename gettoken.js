const response = await fetch(
  "https://solerevivalandredemption.myshopify.com/admin/oauth/access_token",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "4a93dd1fdf9d78c2bdf85d891070dc1b",
      client_secret: "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",
      grant_type: "client_credentials"
    })
  }
);
const data = await response.json();
console.log("TOKEN:", data);
