import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

export function loginErrorMessage(loginErrors) {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Vul je winkeldomein in om in te loggen" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Vul een geldig winkeldomein in om in te loggen" };
  }

  return {};
}
