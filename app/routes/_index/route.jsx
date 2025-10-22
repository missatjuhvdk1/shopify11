import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Een korte kop over [je app]</h1>
        <p className={styles.text}>
          Een tagline over [je app] die je waardepropositie beschrijft.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Winkeldomein</span>
              <input className={styles.input} type="text" name="shop" />
              <span>bijv.: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Inloggen
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Productfunctie</strong>. Enkele details over je functie en
            het voordeel voor je klant.
          </li>
          <li>
            <strong>Productfunctie</strong>. Enkele details over je functie en
            het voordeel voor je klant.
          </li>
          <li>
            <strong>Productfunctie</strong>. Enkele details over je functie en
            het voordeel voor je klant.
          </li>
        </ul>
      </div>
    </div>
  );
}
